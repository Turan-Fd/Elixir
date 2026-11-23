import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('YOUR_PROJECT'));
const supabase = configured ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const state = {
  session: null,
  profile: null,
  route: 'feed',
  routeId: null,
  feedPage: 0,
  feedDone: false,
  feedItems: [],
  groups: [],
  search: '',
  realtime: null
};

const els = {
  loader: document.querySelector('#loader'),
  auth: document.querySelector('#auth-screen'),
  app: document.querySelector('#app-shell'),
  view: document.querySelector('#view'),
  title: document.querySelector('#page-title'),
  action: document.querySelector('#page-action'),
  refresh: document.querySelector('#page-refresh'),
  modal: document.querySelector('#modal-root'),
  toasts: document.querySelector('#toast-root')
};

const e = (value = '') => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const nl = value => e(value).replace(/\n/g, '<br>');
const date = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
const dateTime = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const avatar = profile => profile?.avatar_url || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(profile?.display_name || 'Elixir')}&backgroundColor=1d9bf0&fontFamily=Arial`;
const isEducator = () => ['instructor', 'admin'].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === 'admin';
const currentUserId = () => state.session?.user?.id;

function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 4000);
}

function setLoading(message = 'Loading…') {
  els.view.innerHTML = `<div class="skeleton-list" aria-label="${e(message)}">${Array.from({ length: 3 }, () => '<div class="skeleton-card"><span></span><span></span><span></span></div>').join('')}</div>`;
}

function empty(icon, title, body = '') {
  return `<div class="empty-state"><i class="fa-solid ${e(icon)}"></i><h2>${e(title)}</h2><p>${e(body)}</p></div>`;
}

function errorMessage(error) {
  console.error(error);
  const message = error?.message || 'Something went wrong. Please try again.';
  toast(message, 'error');
  return message;
}

function routeFromHash() {
  const clean = location.hash.replace(/^#\/?/, '') || 'feed';
  const [route, id] = clean.split('/');
  return { route, id };
}

function navigate(route, id = '') {
  location.hash = `#/${route}${id ? `/${id}` : ''}`;
}

function setHeader(title, action = '', actionHandler = null) {
  els.title.textContent = title;
  els.action.textContent = action;
  els.action.style.visibility = action ? 'visible' : 'hidden';
  els.action.onclick = actionHandler;
  els.refresh.style.visibility = 'hidden';
  els.refresh.onclick = null;
}

function renderProfileChrome() {
  const p = state.profile;
  document.querySelector('#sidebar-avatar').src = avatar(p);
  document.querySelector('#sidebar-name').textContent = p.display_name;
  document.querySelector('#sidebar-username').textContent = `@${p.username}`;
  document.querySelector('#admin-nav').classList.toggle('hidden', !isEducator());
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUserId()).single();
  if (error) throw error;
  if (!data.is_active) {
    await supabase.auth.signOut();
    throw new Error('This account has been deactivated. Contact an administrator.');
  }
  state.profile = data;
  renderProfileChrome();
}

async function init() {
  bindStaticEvents();
  if (!configured) {
    els.loader.classList.add('hidden');
    els.auth.classList.remove('hidden');
    document.querySelector('#config-warning').classList.remove('hidden');
    document.querySelector('#config-warning').textContent = 'Supabase is not configured. Copy .env.example to .env and add your project URL and anon key.';
    document.querySelector('#auth-form').querySelectorAll('input,button').forEach(node => { node.disabled = true; });
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  await applySession(session);
  supabase.auth.onAuthStateChange((authEvent, nextSession) => {
    setTimeout(async () => {
      await applySession(nextSession);
      if (authEvent === 'PASSWORD_RECOVERY') openPasswordRecovery();
    }, 0);
  });
}

async function applySession(session) {
  state.session = session;
  els.loader.classList.add('hidden');
  if (!session) {
    state.profile = null;
    els.app.classList.add('hidden');
    els.auth.classList.remove('hidden');
    if (state.realtime) supabase.removeChannel(state.realtime);
    return;
  }
  try {
    await loadProfile();
    els.auth.classList.add('hidden');
    els.app.classList.remove('hidden');
    setupRealtime();
    await handleRoute();
    loadCommunityCount();
    loadUnreadCount();
  } catch (error) {
    errorMessage(error);
  }
}

function bindStaticEvents() {
  window.addEventListener('hashchange', handleRoute);
  document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => navigate(button.dataset.route)));
  document.querySelector('#account-menu').addEventListener('click', async () => {
    if (window.confirm('Log out of Elixir?')) await supabase.auth.signOut();
  });
  document.querySelector('#auth-toggle').addEventListener('click', toggleAuthMode);
  document.querySelector('#auth-form').addEventListener('submit', submitAuth);
  document.querySelector('#reset-password').addEventListener('click', resetPassword);
  document.querySelector('#global-search').addEventListener('input', event => {
    state.search = event.target.value.trim().toLowerCase();
    if (state.route === 'feed') renderFeedItems();
    else if (state.route === 'groups') renderGroups();
    else if (state.route === 'courses') renderCourses();
  });
}

function toggleAuthMode() {
  const fields = document.querySelector('#register-fields');
  const registering = fields.classList.toggle('hidden') === false;
  fields.querySelectorAll('input').forEach(input => { input.required = registering; });
  const password = document.querySelector('#auth-form [name=password]');
  password.autocomplete = registering ? 'new-password' : 'current-password';
  document.querySelector('.auth-submit').textContent = registering ? 'Create account' : 'Log in';
  document.querySelector('#auth-toggle').textContent = registering ? 'Already have an account?' : 'Create an account';
}

async function submitAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  const registering = !document.querySelector('#register-fields').classList.contains('hidden');
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    if (registering) {
      const username = data.username.toLowerCase();
      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: { data: { display_name: data.display_name, username }, emailRedirectTo: `${location.origin}/` }
      });
      if (error) throw error;
      toast('Account created. Check your email to confirm your address.', 'success');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password });
      if (error) throw error;
    }
  } catch (error) { errorMessage(error); }
  finally { button.disabled = false; }
}

async function resetPassword() {
  if (!supabase) return toast('Configure Supabase before requesting a password reset.', 'error');
  const email = document.querySelector('#auth-form [name=email]').value.trim();
  if (!email) return toast('Enter your email address first.', 'error');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/#profile` });
  if (error) errorMessage(error); else toast('Password reset email sent.', 'success');
}

function openPasswordRecovery() {
  showModal('<h2>Choose a new password</h2><form id="recovery-form"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label><button class="post-btn">Update password</button></form>');
  document.querySelector('#recovery-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.password.value !== form.confirm.value) return toast('Passwords do not match.', 'error');
    const { error } = await supabase.auth.updateUser({ password: form.password.value });
    if (error) errorMessage(error); else { closeModal(); toast('Password updated.', 'success'); }
  });
}

async function handleRoute() {
  if (!state.session || !state.profile) return;
  const { route, id } = routeFromHash();
  const allowed = ['feed', 'groups', 'courses', 'lesson', 'assignments', 'notifications', 'profile', 'admin'];
  state.route = allowed.includes(route) ? route : 'feed';
  state.routeId = id;
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.route === state.route));
  try {
    if (state.route === 'feed') await renderFeed();
    if (state.route === 'groups') await renderGroups();
    if (state.route === 'courses') await renderCourses();
    if (state.route === 'lesson') await renderLesson(id);
    if (state.route === 'assignments') await renderAssignments();
    if (state.route === 'notifications') await renderNotifications();
    if (state.route === 'profile') await renderProfile(id || currentUserId());
    if (state.route === 'admin') await renderAdmin();
  } catch (error) {
    els.view.innerHTML = empty('fa-triangle-exclamation', 'Unable to load this page', errorMessage(error));
  }
}

async function loadCommunityCount() {
  const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true);
  document.querySelector('#community-count').textContent = `${count ?? 0} active member${count === 1 ? '' : 's'}`;
}

async function loadUnreadCount() {
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  document.querySelector('#notification-dot').classList.toggle('hidden', !count);
}

function setupRealtime() {
  if (state.realtime) return;
  let timer;
  state.realtime = supabase.channel('community-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => {
      clearTimeout(timer); timer = setTimeout(() => state.route === 'feed' && renderFeed({ preserveScroll: true }), 700);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
      clearTimeout(timer); timer = setTimeout(() => state.route === 'feed' && renderFeed({ preserveScroll: true }), 700);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_reactions' }, () => {
      clearTimeout(timer); timer = setTimeout(() => state.route === 'feed' && renderFeed({ preserveScroll: true }), 700);
    }).subscribe();
}

async function renderFeed({ preserveScroll = false } = {}) {
  const scrollPosition = preserveScroll ? window.scrollY : 0;
  setHeader('Home', 'Qrup', () => navigate('groups'));
  els.refresh.style.visibility = 'visible';
  els.refresh.onclick = () => renderFeed({ preserveScroll: true });
  const { data: groups, error: groupsError } = await supabase.from('community_groups').select('id,name').order('name');
  if (groupsError) throw groupsError;
  state.groups = groups || [];
  state.feedPage = 0;
  state.feedDone = false;
  state.feedItems = [];
  els.view.innerHTML = postComposer() + '<div id="feed-list" class="feeds"></div><button id="load-more" class="load-more" type="button">Load more</button>';
  bindComposer();
  document.querySelector('#load-more').addEventListener('click', loadFeedPage);
  await loadFeedPage();
  if (preserveScroll) window.scrollTo({ top: scrollPosition, behavior: 'instant' });
}

async function renderGroups() {
  setHeader('Groups', isAdmin() ? 'Create group' : 'Refresh', () => isAdmin() ? openGroupForm() : renderGroups());
  setLoading('Loading groupsâ€¦');
  const { data: groups, error } = await supabase.from('community_groups').select('id,name,description,created_at,group_members(count)').order('name');
  if (error) throw error;
  state.groups = groups || [];
  els.view.innerHTML = `<section class="groups-page"><div class="groups-intro"><h1>Your groups</h1><p>Group posts and assignments are visible only to their members.</p></div><div class="card-grid groups-grid">${state.groups.length ? state.groups.map(group => `<article class="group-card"><span class="group-icon"><i class="fa-solid fa-users"></i></span><h2>${e(group.name)}</h2><p>${e(group.description || 'No description yet.')}</p><small>${group.group_members?.[0]?.count || 0} member${group.group_members?.[0]?.count === 1 ? '' : 's'}</small>${isAdmin() ? `<button class="text-button manage-group" data-group="${e(group.id)}">Manage members</button>` : ''}</article>`).join('') : empty('fa-users', 'No groups yet', isAdmin() ? 'Create the first group for your community.' : 'An administrator has not added you to a group yet.')}</div></section>`;
  document.querySelectorAll('.manage-group').forEach(button => button.addEventListener('click', () => openGroupForm(button.dataset.group)));
}

async function openGroupForm(groupId = '') {
  const [{ data: allMembers, error: membersError }, { data: group }] = await Promise.all([
    supabase.from('profiles').select('id,display_name,username,role').eq('is_active', true).order('display_name'),
    groupId ? supabase.from('community_groups').select('id,name,description,group_members(user_id)').eq('id', groupId).single() : Promise.resolve({ data: null })
  ]);
  if (membersError) return errorMessage(membersError);
  const memberIds = new Set(group?.group_members?.map(member => member.user_id) || []);
  showModal(`<h2>${group ? 'Manage group' : 'Create group'}</h2><form id="group-form"><label>Group name<input name="name" minlength="3" maxlength="80" value="${e(group?.name || '')}" required></label><label>Description<textarea name="description" maxlength="500">${e(group?.description || '')}</textarea></label><fieldset class="member-picker"><legend>Members</legend>${allMembers.map(member => `<label class="checkbox"><input type="checkbox" name="members" value="${e(member.id)}" ${memberIds.has(member.id) ? 'checked' : ''}> ${e(member.display_name)} <small>@${e(member.username)} · ${e(member.role)}</small></label>`).join('')}</fieldset><button class="post-btn">${group ? 'Save group' : 'Create group'}</button></form>`);
  document.querySelector('#group-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const memberIdsToSave = [...form.querySelectorAll('[name=members]:checked')].map(input => input.value);
    try {
      let savedGroupId = groupId;
      if (group) {
        const { error: updateError } = await supabase.from('community_groups').update({ name: form.name.value.trim(), description: form.description.value.trim() }).eq('id', groupId);
        if (updateError) throw updateError;
        const { error: clearError } = await supabase.from('group_members').delete().eq('group_id', groupId);
        if (clearError) throw clearError;
      } else {
        const { data: created, error: createError } = await supabase.from('community_groups').insert({ name: form.name.value.trim(), description: form.description.value.trim(), created_by: currentUserId() }).select('id').single();
        if (createError) throw createError;
        savedGroupId = created.id;
      }
      if (memberIdsToSave.length) {
        const { error: addError } = await supabase.from('group_members').insert(memberIdsToSave.map(user_id => ({ group_id: savedGroupId, user_id })));
        if (addError) throw addError;
      }
      closeModal(); toast(group ? 'Group updated.' : 'Group created.', 'success'); await renderGroups();
    } catch (error) { errorMessage(error); }
  });
}

function postComposer() {
  const groupTargeting = isEducator() && state.groups.length
    ? `<label class="composer-select">Visible to groups<select name="group_ids" multiple size="${Math.min(4, state.groups.length)}">${state.groups.map(group => `<option value="${e(group.id)}">${e(group.name)}</option>`).join('')}</select><small>Leave empty for the whole community.</small></label>`
    : '';
  return `<form id="post-form" class="post" novalidate>
    <div class="post-ust"><div class="profile-img post-mi"><img src="${e(avatar(state.profile))}" alt=""></div><div class="text-input"><textarea id="autoTextarea" name="body" placeholder="Share with the community" maxlength="3000" required></textarea><div id="post-preview" class="image-preview hidden"></div></div></div>
    <div class="composer-options"><label>Post type<select name="post_kind"><option value="post">Community post</option><option value="help">Help question</option></select></label>${groupTargeting}</div>
    <div class="post-alt"><div class="mini-functions"><label class="function" title="Add image"><i class="fa-solid fa-image"></i><input id="post-image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></label>${isEducator() ? '<label class="function" title="Attach learning materials"><i class="fa-solid fa-paperclip"></i><input id="post-materials" name="materials" type="file" multiple accept=".pdf,.html,.txt,.zip,.docx,.pptx,.xlsx,image/jpeg,image/png,image/webp" hidden></label><span id="material-count" class="material-count"></span>' : ''}</div><button class="post-btn" type="submit">Post</button></div>
  </form>`;
}

function bindComposer() {
  const textarea = document.querySelector('#autoTextarea');
  textarea.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = `${this.scrollHeight}px`; });
  document.querySelector('#post-image').addEventListener('change', event => {
    const file = event.target.files[0];
    const preview = document.querySelector('#post-preview');
    if (!file) return preview.classList.add('hidden');
    if (file.size > 10 * 1024 * 1024) { event.target.value = ''; return toast('Images must be 10 MB or smaller.', 'error'); }
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Selected post image">`;
    preview.classList.remove('hidden');
  });
  document.querySelector('#post-materials')?.addEventListener('change', event => {
    const files = [...event.target.files];
    const tooLarge = files.find(file => file.size > 25 * 1024 * 1024);
    if (tooLarge) {
      event.target.value = '';
      document.querySelector('#material-count').textContent = '';
      return toast(`${tooLarge.name} must be 25 MB or smaller.`, 'error');
    }
    document.querySelector('#material-count').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : '';
  });
  document.querySelector('#post-form').addEventListener('submit', createPost);
}

async function createPost(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = form.body.value.trim();
  if (!body) return;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  let createdPostId = null;
  const uploadedMaterials = [];
  try {
    let mediaUrl = null;
    const file = form.image.files[0];
    if (file) {
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `${currentUserId()}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('post-media').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      mediaUrl = supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;
    }
    const groupIds = [...form.group_ids?.selectedOptions || []].map(option => option.value);
    const postKind = form.post_kind.value;
    const { data: returnedPostId, error } = await supabase.rpc('create_post_with_groups', { post_body: body, post_media_url: mediaUrl, target_group_ids: groupIds, requested_kind: postKind });
    if (error) throw error;
    createdPostId = returnedPostId;
    for (const material of [...(form.materials?.files || [])]) {
      const safeName = material.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${currentUserId()}/${createdPostId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('post-materials').upload(path, material, { contentType: material.type });
      if (uploadError) throw uploadError;
      uploadedMaterials.push(path);
      const { error: attachmentError } = await supabase.from('post_attachments').insert({ post_id: createdPostId, file_name: material.name, storage_path: path, mime_type: material.type || 'application/octet-stream', file_size: material.size });
      if (attachmentError) throw attachmentError;
    }
    form.reset();
    document.querySelector('#post-preview').classList.add('hidden');
    toast(postKind === 'help' ? 'Help question posted.' : 'Posted to the community.', 'success');
    await renderFeed();
  } catch (error) {
    if (uploadedMaterials.length) await supabase.storage.from('post-materials').remove(uploadedMaterials);
    if (createdPostId) await supabase.from('posts').delete().eq('id', createdPostId);
    errorMessage(error);
  }
  finally { button.disabled = false; }
}

async function loadFeedPage() {
  const from = state.feedPage * 10;
  const to = from + 9;
  const [postsResult, announcementsResult] = await Promise.all([
    supabase.from('posts').select('id,body,media_url,post_kind,author_id,created_at,updated_at,profile:profiles!posts_author_id_fkey(display_name,username,avatar_url,role),comments(count),post_reactions(count),post_attachments(id,file_name,storage_path,mime_type,file_size),post_groups(group:community_groups(id,name))').order('created_at', { ascending: false }).range(from, to),
    state.feedPage === 0 ? supabase.from('announcements').select('id,title,body,is_pinned,published_at,author_id,profile:profiles!announcements_author_id_fkey(display_name,username,avatar_url,role)').order('is_pinned', { ascending: false }).order('published_at', { ascending: false }).limit(10) : Promise.resolve({ data: [], error: null })
  ]);
  if (postsResult.error) throw postsResult.error;
  if (announcementsResult.error) throw announcementsResult.error;
  const postIds = postsResult.data.map(post => post.id);
  const liked = postIds.length ? await supabase.from('post_reactions').select('post_id').eq('user_id', currentUserId()).in('post_id', postIds) : { data: [] };
  const likedSet = new Set(liked.data?.map(item => item.post_id));
  const posts = postsResult.data.map(post => ({ ...post, kind: 'post', liked: likedSet.has(post.id), sortDate: post.created_at }));
  const announcements = announcementsResult.data.map(item => ({ ...item, kind: 'announcement', sortDate: item.published_at }));
  state.feedItems.push(...announcements, ...posts);
  state.feedItems.sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));
  state.feedPage += 1;
  state.feedDone = postsResult.data.length < 10;
  renderFeedItems();
}

function renderFeedItems() {
  const list = document.querySelector('#feed-list');
  if (!list) return;
  const items = state.feedItems.filter(item => !state.search || `${item.body} ${item.title || ''} ${item.profile?.display_name || ''}`.toLowerCase().includes(state.search));
  list.innerHTML = items.length ? items.map(item => item.kind === 'announcement' ? announcementCard(item) : postCard(item)).join('') : empty('fa-comments', 'No posts yet', 'Start the conversation with your bootcamp community.');
  document.querySelector('#load-more').classList.toggle('hidden', state.feedDone || Boolean(state.search));
  bindFeedActions();
}

function authorHeader(item) {
  return `<div class="fh"><button class="user-fi profile-link" data-user="${e(item.author_id)}"><span class="profile-img user-profile"><img src="${e(avatar(item.profile))}" alt=""></span><span class="ua"><span class="ad">${e(item.profile?.display_name || 'Community member')}</span><span class="username">@${e(item.profile?.username || 'member')} · ${date(item.sortDate)}</span></span></button>${item.kind === 'post' && (item.author_id === currentUserId() || isAdmin()) ? `<button class="more-fs post-menu" data-post="${e(item.id)}" aria-label="Post options"><i class="fa-solid fa-ellipsis"></i></button>` : ''}</div>`;
}

function postCard(post) {
  const commentCount = post.comments?.[0]?.count || 0;
  const reactionCount = post.post_reactions?.[0]?.count || 0;
  const materials = post.post_attachments?.length ? `<div class="post-materials">${post.post_attachments.map(file => `<button class="post-material" data-path="${e(file.storage_path)}" data-name="${e(file.file_name)}"><i class="fa-solid fa-file-arrow-down"></i><span>${e(file.file_name)}<small>${e(file.mime_type)}</small></span></button>`).join('')}</div>` : '';
  const groups = post.post_groups?.map(item => item.group?.name).filter(Boolean) || [];
  const labels = `${post.post_kind === 'help' ? '<span class="post-label help-label"><i class="fa-solid fa-circle-question"></i> Help request</span>' : ''}${groups.map(name => `<span class="post-label group-label"><i class="fa-solid fa-users"></i> ${e(name)}</span>`).join('')}`;
  return `<article class="feed" data-post-id="${e(post.id)}">${authorHeader(post)}<div class="f-content">${labels ? `<div class="post-labels">${labels}</div>` : ''}<div class="fc-text">${nl(post.body)}</div>${post.media_url ? `<div class="fc-feed"><img src="${e(post.media_url)}" alt="Post attachment" loading="lazy"></div>` : ''}${materials}</div><div class="react-btns"><button class="react-btn es comment-button" data-post="${e(post.id)}"><i class="fa-solid fa-comment e"></i><span class="total-amount">${commentCount}</span></button><button class="react-btn hes like-button ${post.liked ? 'liked' : ''}" data-post="${e(post.id)}" data-liked="${post.liked}"><i class="fa-${post.liked ? 'solid' : 'regular'} fa-heart he"></i><span class="total-amount">${reactionCount}</span></button><span class="br"><button class="react-btn es share-button" data-post="${e(post.id)}"><i class="fa-solid fa-share e"></i></button></span></div></article>`;
}

function announcementCard(item) {
  return `<article class="feed announcement ${item.is_pinned ? 'pinned' : ''}">${authorHeader(item)}<div class="f-content"><div class="announcement-label"><i class="fa-solid fa-bullhorn"></i> ${item.is_pinned ? 'Pinned announcement' : 'Announcement'}</div><h2>${e(item.title)}</h2><div class="fc-text">${nl(item.body)}</div></div></article>`;
}

function bindFeedActions() {
  document.querySelectorAll('.profile-link').forEach(button => button.addEventListener('click', () => navigate('profile', button.dataset.user)));
  document.querySelectorAll('.like-button').forEach(button => button.addEventListener('click', () => toggleLike(button)));
  document.querySelectorAll('.comment-button').forEach(button => button.addEventListener('click', () => openComments(button.dataset.post)));
  document.querySelectorAll('.share-button').forEach(button => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/feed?post=${button.dataset.post}`);
    toast('Post link copied.', 'success');
  }));
  document.querySelectorAll('.post-menu').forEach(button => button.addEventListener('click', () => openPostMenu(button.dataset.post)));
  document.querySelectorAll('.post-material').forEach(button => button.addEventListener('click', async () => {
    const { data, error } = await supabase.storage.from('post-materials').createSignedUrl(button.dataset.path, 60, { download: button.dataset.name });
    if (error) errorMessage(error); else window.open(data.signedUrl, '_blank', 'noopener');
  }));
}

async function toggleLike(button) {
  button.disabled = true;
  const liked = button.dataset.liked === 'true';
  const query = liked
    ? supabase.from('post_reactions').delete().eq('post_id', button.dataset.post).eq('user_id', currentUserId())
    : supabase.from('post_reactions').insert({ post_id: button.dataset.post, user_id: currentUserId() });
  const { error } = await query;
  if (error) errorMessage(error); else await renderFeed();
}

function showModal(content) {
  els.modal.innerHTML = `<div class="modal-backdrop"><section class="modal-card" role="dialog" aria-modal="true"><button class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>${content}</section></div>`;
  els.modal.querySelector('.modal-close').addEventListener('click', closeModal);
  els.modal.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
}
function closeModal() { els.modal.innerHTML = ''; }

async function openComments(postId) {
  showModal('<h2>Comments</h2><div class="skeleton-card"><span></span><span></span></div>');
  const { data, error } = await supabase.from('comments').select('id,body,author_id,created_at,profile:profiles!comments_author_id_fkey(display_name,username,avatar_url)').eq('post_id', postId).order('created_at');
  if (error) return errorMessage(error);
  showModal(`<h2>Comments</h2><div class="comments-list">${data.length ? data.map(comment => `<article class="comment"><img src="${e(avatar(comment.profile))}" alt=""><div><strong>${e(comment.profile.display_name)}</strong><span class="username"> @${e(comment.profile.username)} · ${date(comment.created_at)}</span><p>${nl(comment.body)}</p></div>${comment.author_id === currentUserId() || isAdmin() ? `<button class="delete-comment" data-comment="${e(comment.id)}" aria-label="Delete comment"><i class="fa-solid fa-trash"></i></button>` : ''}</article>`).join('') : '<p class="muted">No comments yet.</p>'}</div><form id="comment-form" class="inline-form"><input name="body" maxlength="1000" placeholder="Write a comment" required><button class="post-btn">Reply</button></form>`);
  document.querySelector('#comment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const body = event.currentTarget.body.value.trim();
    if (!body) return;
    const { error: insertError } = await supabase.from('comments').insert({ post_id: postId, author_id: currentUserId(), body });
    if (insertError) errorMessage(insertError); else { closeModal(); await openComments(postId); }
  });
  document.querySelectorAll('.delete-comment').forEach(button => button.addEventListener('click', async () => {
    if (!window.confirm('Delete this comment?')) return;
    const { error: deleteError } = await supabase.from('comments').delete().eq('id', button.dataset.comment);
    if (deleteError) errorMessage(deleteError); else { closeModal(); await openComments(postId); }
  }));
}

function openPostMenu(postId) {
  const post = state.feedItems.find(item => item.id === postId);
  showModal(`<h2>Post options</h2><form id="edit-post-form"><label>Post text<textarea name="body" maxlength="3000" required>${e(post.body)}</textarea></label><div class="form-actions"><button class="post-btn">Save</button><button id="delete-post" class="danger-button" type="button">Delete</button></div></form>`);
  document.querySelector('#edit-post-form').addEventListener('submit', async event => {
    event.preventDefault();
    const { error } = await supabase.from('posts').update({ body: event.currentTarget.body.value.trim() }).eq('id', postId);
    if (error) errorMessage(error); else { closeModal(); await renderFeed(); }
  });
  document.querySelector('#delete-post').addEventListener('click', async () => {
    if (!window.confirm('Permanently delete this post?')) return;
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    if (error) errorMessage(error); else { closeModal(); await renderFeed(); }
  });
}

async function renderCourses() {
  setHeader('Learning', 'My courses');
  setLoading();
  const [{ data: courses, error }, { data: enrollments }] = await Promise.all([
    supabase.from('courses').select('id,title,description,cover_image_url,instructor_id,created_at,instructor:profiles!courses_instructor_id_fkey(display_name,avatar_url),lessons(count)').eq('status', 'published').order('created_at', { ascending: false }),
    supabase.from('course_enrollments').select('course_id,last_lesson_id').eq('user_id', currentUserId())
  ]);
  if (error) throw error;
  const enrolled = new Map(enrollments?.map(item => [item.course_id, item]));
  const filtered = courses.filter(course => !state.search || `${course.title} ${course.description}`.toLowerCase().includes(state.search));
  els.view.innerHTML = `<div class="card-grid">${filtered.length ? filtered.map(course => `<article class="course-card">${course.cover_image_url ? `<img src="${e(course.cover_image_url)}" alt="">` : '<div class="course-cover"><i class="fa-solid fa-shield-halved"></i></div>'}<div class="card-content"><span class="eyebrow">${course.lessons?.[0]?.count || 0} lessons</span><h2>${e(course.title)}</h2><p>${e(course.description)}</p><div class="course-instructor"><img src="${e(avatar(course.instructor))}" alt="">${e(course.instructor?.display_name || 'Elixir instructor')}</div><button class="post-btn course-open" data-course="${e(course.id)}" data-enrolled="${enrolled.has(course.id)}">${enrolled.has(course.id) ? 'Continue' : 'Enroll'}</button></div></article>`).join('') : empty('fa-graduation-cap', 'No courses available', 'Published courses will appear here.')}</div>`;
  document.querySelectorAll('.course-open').forEach(button => button.addEventListener('click', async () => {
    if (button.dataset.enrolled !== 'true') {
      const { error: enrollError } = await supabase.from('course_enrollments').insert({ course_id: button.dataset.course, user_id: currentUserId() });
      if (enrollError) return errorMessage(enrollError);
      toast('You joined the course.', 'success');
    }
    await openCourse(button.dataset.course);
  }));
}

async function openCourse(courseId) {
  setLoading();
  const [{ data: course, error }, { data: lessons }, { data: progress }] = await Promise.all([
    supabase.from('courses').select('*').eq('id', courseId).single(),
    supabase.from('lessons').select('id,lesson_number,title,description,sort_order').eq('course_id', courseId).eq('status', 'published').order('sort_order'),
    supabase.from('lesson_progress').select('lesson_id,completed').eq('user_id', currentUserId())
  ]);
  if (error) throw error;
  const completed = new Set(progress?.filter(item => item.completed).map(item => item.lesson_id));
  const percent = lessons.length ? Math.round((lessons.filter(lesson => completed.has(lesson.id)).length / lessons.length) * 100) : 0;
  setHeader(course.title, `${percent}% complete`);
  els.view.innerHTML = `<section class="course-hero"><span class="eyebrow">Course</span><h1>${e(course.title)}</h1><p>${e(course.description)}</p><div class="progress-track"><span style="width:${percent}%"></span></div></section><div class="lesson-list">${lessons.length ? lessons.map(lesson => `<button class="lesson-row" data-lesson="${e(lesson.id)}"><span class="lesson-number">${String(lesson.lesson_number).padStart(2, '0')}</span><span><strong>${e(lesson.title)}</strong><small>${e(lesson.description)}</small></span><i class="fa-solid ${completed.has(lesson.id) ? 'fa-circle-check completed' : 'fa-chevron-right'}"></i></button>`).join('') : empty('fa-book-open', 'No lessons yet')}</div>`;
  document.querySelectorAll('.lesson-row').forEach(button => button.addEventListener('click', () => navigate('lesson', button.dataset.lesson)));
}

function youtubeEmbed(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    let id = parsed.hostname.includes('youtu.be') ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
    if (!id && parsed.pathname.includes('/embed/')) id = parsed.pathname.split('/embed/')[1];
    if (!/^[\w-]{11}$/.test(id || '')) return `<a class="external-video" href="${e(url)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-circle-play"></i> Open lesson video</a>`;
    return `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="Lesson video" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  } catch { return ''; }
}

async function renderLesson(lessonId) {
  if (!lessonId) return navigate('courses');
  setLoading();
  const [{ data: lesson, error }, { data: attachments }, { data: progress }] = await Promise.all([
    supabase.from('lessons').select('*,course:courses(title)').eq('id', lessonId).single(),
    supabase.from('lesson_attachments').select('*').eq('lesson_id', lessonId),
    supabase.from('lesson_progress').select('*').eq('lesson_id', lessonId).eq('user_id', currentUserId()).maybeSingle()
  ]);
  if (error) throw error;
  await supabase.from('lesson_progress').upsert({ lesson_id: lessonId, user_id: currentUserId(), completed: progress?.completed || false, completed_at: progress?.completed_at || null }, { onConflict: 'lesson_id,user_id' });
  await supabase.from('course_enrollments').update({ last_lesson_id: lessonId, last_viewed_at: new Date().toISOString() }).eq('course_id', lesson.course_id).eq('user_id', currentUserId());
  setHeader(`Lesson ${String(lesson.lesson_number).padStart(2, '0')}`, lesson.course.title, () => openCourse(lesson.course_id));
  els.view.innerHTML = `<article class="lesson-view">${youtubeEmbed(lesson.video_url)}<span class="eyebrow">${e(lesson.course.title)}</span><h1>${e(lesson.title)}</h1><p class="lesson-description">${e(lesson.description)}</p><div class="lesson-content">${nl(lesson.content)}</div>${attachments.length ? `<section class="attachments"><h2>Lesson materials</h2>${attachments.map(file => `<button class="attachment" data-path="${e(file.storage_path)}" data-name="${e(file.file_name)}"><i class="fa-solid fa-file-arrow-down"></i><span>${e(file.file_name)}<small>${e(file.mime_type)}</small></span></button>`).join('')}</section>` : ''}<button id="complete-lesson" class="complete-button ${progress?.completed ? 'done' : ''}"><i class="fa-solid fa-circle-check"></i> ${progress?.completed ? 'Completed' : 'Mark lesson complete'}</button></article>`;
  document.querySelector('#complete-lesson').addEventListener('click', async buttonEvent => {
    const completed = !buttonEvent.currentTarget.classList.contains('done');
    const { error: progressError } = await supabase.from('lesson_progress').upsert({ lesson_id: lessonId, user_id: currentUserId(), completed, completed_at: completed ? new Date().toISOString() : null }, { onConflict: 'lesson_id,user_id' });
    if (progressError) errorMessage(progressError); else { toast(completed ? 'Lesson completed!' : 'Lesson marked incomplete.', 'success'); await renderLesson(lessonId); }
  });
  document.querySelectorAll('.attachment').forEach(button => button.addEventListener('click', async () => {
    const { data, error: signedError } = await supabase.storage.from('lesson-materials').createSignedUrl(button.dataset.path, 60, { download: button.dataset.name });
    if (signedError) errorMessage(signedError); else window.open(data.signedUrl, '_blank', 'noopener');
  }));
}

async function renderAssignments() {
  setHeader('Assignments', 'Your work');
  setLoading();
  const { data, error } = await supabase.from('assignments').select('*,course:courses(title),assignment_submissions(id,status,submitted_at,feedback)').eq('status', 'published').order('due_at');
  if (error) throw error;
  els.view.innerHTML = `<div class="assignment-list">${data.length ? data.map(item => { const submission = item.assignment_submissions?.[0]; return `<article class="assignment-card"><div><span class="eyebrow">${e(item.course.title)}</span><h2>${e(item.title)}</h2><p>${e(item.description)}</p><span class="due-date"><i class="fa-regular fa-clock"></i> ${item.due_at ? `Due ${dateTime(item.due_at)}` : 'No due date'}</span>${!item.counts_toward_selection_exam ? '<span class="score-note">Does not count toward the selection exam score</span>' : ''}</div><button class="post-btn submit-assignment" data-assignment="${e(item.id)}" data-submission="${e(submission?.id || '')}">${submission ? e(submission.status) : 'Submit'}</button>${submission?.feedback ? `<div class="feedback"><strong>Instructor feedback</strong><p>${e(submission.feedback)}</p></div>` : ''}</article>`; }).join('') : empty('fa-list-check', 'No assignments', 'Published assignments will appear here.')}</div>`;
  document.querySelectorAll('.submit-assignment').forEach(button => button.addEventListener('click', () => openSubmission(button.dataset.assignment, button.dataset.submission)));
}

async function openSubmission(assignmentId, submissionId) {
  let submission = null;
  if (submissionId) {
    const result = await supabase.from('assignment_submissions').select('*').eq('id', submissionId).single();
    submission = result.data;
  }
  showModal(`<h2>Assignment submission</h2><form id="submission-form"><label>Your response<textarea name="content" maxlength="10000" required>${e(submission?.content || '')}</textarea></label><label>Optional file (max 25 MB)<input name="file" type="file"></label><button class="post-btn">Submit work</button></form>`);
  document.querySelector('#submission-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.file.files[0];
    if (file?.size > 25 * 1024 * 1024) return toast('Files must be 25 MB or smaller.', 'error');
    try {
      let attachmentPath = submission?.attachment_path || null;
      if (file) {
        attachmentPath = `${currentUserId()}/${assignmentId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage.from('assignment-files').upload(attachmentPath, file, { contentType: file.type });
        if (uploadError) throw uploadError;
      }
      const payload = { assignment_id: assignmentId, student_id: currentUserId(), content: form.content.value.trim(), attachment_path: attachmentPath, status: 'submitted', submitted_at: new Date().toISOString() };
      const { error } = await supabase.from('assignment_submissions').upsert(payload, { onConflict: 'assignment_id,student_id' });
      if (error) throw error;
      closeModal(); toast('Assignment submitted.', 'success'); await renderAssignments();
    } catch (error) { errorMessage(error); }
  });
}

async function renderNotifications() {
  setHeader('Notifications', 'Mark all read', async () => {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', currentUserId()).is('read_at', null);
    if (error) errorMessage(error); else { await renderNotifications(); await loadUnreadCount(); }
  });
  setLoading();
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  els.view.innerHTML = `<div class="notification-list">${data.length ? data.map(item => `<button class="notification ${item.read_at ? '' : 'unread'}" data-id="${e(item.id)}" data-href="${e(item.href || '')}"><i class="fa-solid ${item.kind === 'announcement' ? 'fa-bullhorn' : item.kind === 'assignment' ? 'fa-list-check' : 'fa-bell'}"></i><span><strong>${e(item.title)}</strong><p>${e(item.body)}</p><small>${dateTime(item.created_at)}</small></span></button>`).join('') : empty('fa-bell-slash', 'All caught up', 'New activity will appear here.')}</div>`;
  document.querySelectorAll('.notification').forEach(button => button.addEventListener('click', async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', button.dataset.id);
    if (button.dataset.href?.startsWith('#/')) location.hash = button.dataset.href;
    else await renderNotifications();
    loadUnreadCount();
  }));
}

async function renderProfile(userId) {
  setHeader(userId === currentUserId() ? 'Your profile' : 'Profile', userId === currentUserId() ? 'Edit profile' : '', userId === currentUserId() ? openProfileEditor : null);
  setLoading();
  const [{ data: profile, error }, { data: posts }, { data: progress }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    supabase.from('posts').select('id,body,media_url,created_at').eq('author_id', userId).order('created_at', { ascending: false }).limit(20),
    userId === currentUserId() ? supabase.from('lesson_progress').select('lesson_id').eq('user_id', userId).eq('completed', true) : Promise.resolve({ data: [] })
  ]);
  if (error) throw error;
  els.view.innerHTML = `<section class="profile-header"><div class="profile-banner"></div><img class="profile-avatar-large" src="${e(avatar(profile))}" alt="${e(profile.display_name)}"><div class="profile-details"><h1>${e(profile.display_name)}</h1><span class="username">@${e(profile.username)}</span><span class="role-badge">${e(profile.role)}</span><p>${e(profile.bio || 'No bio yet.')}</p><div class="profile-meta"><span><i class="fa-regular fa-calendar"></i> Joined ${date(profile.joined_at)}</span>${userId === currentUserId() ? `<span><i class="fa-solid fa-circle-check"></i> ${progress.length} lessons completed</span>` : ''}</div></div></section><div class="profile-posts"><h2>Posts</h2>${posts.length ? posts.map(post => `<article class="feed"><div class="fc-text">${nl(post.body)}</div>${post.media_url ? `<div class="fc-feed"><img src="${e(post.media_url)}" alt=""></div>` : ''}<small class="muted">${date(post.created_at)}</small></article>`).join('') : empty('fa-pen', 'No posts yet')}</div>`;
}

function openProfileEditor() {
  showModal(`<h2>Edit profile</h2><form id="profile-form"><label>Display name<input name="display_name" value="${e(state.profile.display_name)}" minlength="2" maxlength="80" required></label><label>Username<input name="username" value="${e(state.profile.username)}" pattern="[a-z0-9_]{3,30}" required></label><label>Bio<textarea name="bio" maxlength="500">${e(state.profile.bio)}</textarea></label><label>Profile photo<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><button class="post-btn">Save</button></form>`);
  document.querySelector('#profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      let avatarUrl = state.profile.avatar_url;
      const file = form.avatar.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Avatar must be 5 MB or smaller.');
        const ext = file.name.split('.').pop().toLowerCase();
        const path = `${currentUserId()}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true });
        if (uploadError) throw uploadError;
        avatarUrl = `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      }
      const { error } = await supabase.from('profiles').update({ display_name: form.display_name.value.trim(), username: form.username.value.trim().toLowerCase(), bio: form.bio.value.trim(), avatar_url: avatarUrl }).eq('id', currentUserId());
      if (error) throw error;
      await loadProfile(); closeModal(); toast('Profile updated.', 'success'); await renderProfile(currentUserId());
    } catch (error) { errorMessage(error); }
  });
}

async function renderAdmin() {
  if (!isEducator()) { navigate('feed'); return; }
  setHeader('Admin', 'Create', openAdminCreateMenu);
  setLoading();
  const courseFilter = isAdmin() ? {} : { instructor_id: currentUserId() };
  let coursesQuery = supabase.from('courses').select('id,title,status,instructor_id').order('created_at', { ascending: false });
  if (courseFilter.instructor_id) coursesQuery = coursesQuery.eq('instructor_id', currentUserId());
  const results = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('role', 'student'),
    supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    supabase.from('lesson_progress').select('lesson_id', { count: 'exact', head: true }).eq('completed', true),
    supabase.from('assignment_submissions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    coursesQuery,
    supabase.from('assignment_submissions').select('id,status,submitted_at,student:profiles!assignment_submissions_student_id_fkey(display_name),assignment:assignments(title,course_id)').order('submitted_at', { ascending: false }).limit(10),
    isAdmin() ? supabase.from('profiles').select('id,display_name,username,role,is_active').order('joined_at', { ascending: false }).limit(50) : Promise.resolve({ data: [] })
  ]);
  const [members, lessons, completed, submissionsCount, courses, submissions, students] = results;
  const managedCourseIds = new Set(courses.data?.map(item => item.id));
  const visibleSubmissions = isAdmin() ? submissions.data : submissions.data?.filter(item => managedCourseIds.has(item.assignment.course_id));
  els.view.innerHTML = `<div class="analytics-grid">${metric('fa-users', members.count, 'Active students')}${metric('fa-book-open', lessons.count, 'Published lessons')}${metric('fa-circle-check', completed.count, 'Completed lessons')}${metric('fa-inbox', submissionsCount.count, 'Awaiting review')}</div><section class="admin-section"><h2>Courses</h2>${courses.data?.map(course => `<div class="admin-row"><span><strong>${e(course.title)}</strong><small>${e(course.status)}</small></span><button class="text-button add-lesson" data-course="${e(course.id)}">Add lesson</button><button class="text-button add-assignment" data-course="${e(course.id)}">Add assignment</button></div>`).join('') || '<p class="muted">No managed courses.</p>'}</section><section class="admin-section"><h2>Recent submissions</h2>${visibleSubmissions?.map(submission => `<div class="admin-row"><span><strong>${e(submission.student.display_name)}</strong><small>${e(submission.assignment.title)} · ${dateTime(submission.submitted_at)}</small></span><button class="text-button review-submission" data-submission="${e(submission.id)}">Review</button></div>`).join('') || '<p class="muted">No submissions to review.</p>'}</section>${isAdmin() ? `<section class="admin-section"><h2>Students and roles</h2>${students.data.map(student => `<div class="admin-row"><span><strong>${e(student.display_name)}</strong><small>@${e(student.username)} · ${e(student.role)}</small></span><button class="text-button manage-user" data-user="${e(student.id)}" data-role="${e(student.role)}" data-active="${student.is_active}">${student.is_active ? 'Manage' : 'Inactive'}</button></div>`).join('')}</section>` : ''}`;
  bindAdminActions();
}

function metric(icon, count, label) { return `<article class="metric-card"><i class="fa-solid ${icon}"></i><strong>${count ?? 0}</strong><span>${label}</span></article>`; }

function openAdminCreateMenu() {
  showModal(`<h2>Create</h2><div class="modal-menu"><button id="create-course"><i class="fa-solid fa-graduation-cap"></i> Course</button><button id="create-announcement"><i class="fa-solid fa-bullhorn"></i> Announcement</button>${isAdmin() ? '<button id="create-group"><i class="fa-solid fa-users"></i> Group</button>' : ''}</div>`);
  document.querySelector('#create-course').addEventListener('click', openCourseForm);
  document.querySelector('#create-announcement').addEventListener('click', openAnnouncementForm);
  document.querySelector('#create-group')?.addEventListener('click', () => openGroupForm());
}

function openCourseForm() {
  showModal(`<h2>New course</h2><form id="course-form"><label>Title<input name="title" minlength="3" maxlength="160" required></label><label>Description<textarea name="description" required></textarea></label><label>Cover image URL<input name="cover_image_url" type="url"></label><label>Status<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label><button class="post-btn">Create</button></form>`);
  document.querySelector('#course-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    const { error } = await supabase.from('courses').insert({ title: form.title.value.trim(), description: form.description.value.trim(), cover_image_url: form.cover_image_url.value.trim() || null, instructor_id: currentUserId(), status: form.status.value });
    if (error) errorMessage(error); else { closeModal(); toast('Course created.', 'success'); await renderAdmin(); }
  });
}

async function openAnnouncementForm() {
  const { data: courses } = await supabase.from('courses').select('id,title').order('title');
  showModal(`<h2>New announcement</h2><form id="announcement-form"><label>Title<input name="title" minlength="3" maxlength="160" required></label><label>Message<textarea name="body" maxlength="3000" required></textarea></label><label>Course (optional)<select name="course_id"><option value="">Whole community</option>${courses.map(course => `<option value="${e(course.id)}">${e(course.title)}</option>`).join('')}</select></label><label class="checkbox"><input name="is_pinned" type="checkbox"> Pin announcement</label><button class="post-btn">Publish</button></form>`);
  document.querySelector('#announcement-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    const { error } = await supabase.from('announcements').insert({ author_id: currentUserId(), title: form.title.value.trim(), body: form.body.value.trim(), course_id: form.course_id.value || null, is_pinned: form.is_pinned.checked });
    if (error) errorMessage(error); else { closeModal(); toast('Announcement published.', 'success'); }
  });
}

function bindAdminActions() {
  document.querySelectorAll('.add-lesson').forEach(button => button.addEventListener('click', () => openLessonForm(button.dataset.course)));
  document.querySelectorAll('.add-assignment').forEach(button => button.addEventListener('click', () => openAssignmentForm(button.dataset.course)));
  document.querySelectorAll('.review-submission').forEach(button => button.addEventListener('click', () => reviewSubmission(button.dataset.submission)));
  document.querySelectorAll('.manage-user').forEach(button => button.addEventListener('click', () => manageUser(button)));
}

async function openLessonForm(courseId) {
  const { data: existing } = await supabase.from('lessons').select('lesson_number,sort_order').eq('course_id', courseId).order('sort_order', { ascending: false }).limit(1);
  const next = (existing?.[0]?.sort_order || 0) + 1;
  showModal(`<h2>Add lesson</h2><form id="lesson-form"><div class="form-pair"><label>Lesson number<input name="lesson_number" type="number" min="1" value="${next}" required></label><label>Sort order<input name="sort_order" type="number" min="0" value="${next}" required></label></div><label>Title<input name="title" minlength="3" maxlength="160" required></label><label>Description<textarea name="description"></textarea></label><label>Written content<textarea name="content" class="tall-textarea"></textarea></label><label>Video URL<input name="video_url" type="url" placeholder="YouTube or external URL"></label><label>Status<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label><label>Materials (PDF, HTML, TXT, ZIP, images; max 25 MB each)<input name="materials" type="file" multiple accept=".pdf,.html,.txt,.zip,image/jpeg,image/png,image/webp"></label><button class="post-btn">Save lesson</button></form>`);
  document.querySelector('#lesson-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    try {
      const { data: lesson, error } = await supabase.from('lessons').insert({ course_id: courseId, lesson_number: Number(form.lesson_number.value), sort_order: Number(form.sort_order.value), title: form.title.value.trim(), description: form.description.value.trim(), content: form.content.value.trim(), video_url: form.video_url.value.trim() || null, status: form.status.value }).select('id').single();
      if (error) throw error;
      for (const file of form.materials.files) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} exceeds 25 MB.`);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${courseId}/${lesson.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from('lesson-materials').upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;
        const { error: recordError } = await supabase.from('lesson_attachments').insert({ lesson_id: lesson.id, file_name: file.name, storage_path: path, mime_type: file.type || 'application/octet-stream', file_size: file.size });
        if (recordError) throw recordError;
      }
      closeModal(); toast('Lesson saved.', 'success'); await renderAdmin();
    } catch (error) { errorMessage(error); }
  });
}

async function openAssignmentForm(courseId) {
  const { data: groups, error: groupsError } = await supabase.from('community_groups').select('id,name').order('name');
  if (groupsError) return errorMessage(groupsError);
  showModal(`<h2>New assignment</h2><form id="assignment-form"><label>Assigned group<select name="group_id"><option value="">Course members</option>${groups.map(group => `<option value="${e(group.id)}">${e(group.name)}</option>`).join('')}</select><small>Every member of the selected group receives a notification when published.</small></label><label>Title<input name="title" minlength="3" maxlength="160" required></label><label>Description<textarea name="description" required></textarea></label><label>Due date<input name="due_at" type="datetime-local"></label><label>Status<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label><label class="checkbox"><input name="counts" type="checkbox"> Counts toward selection exam score</label><p class="muted">Leave unchecked for homework and classroom activity during the first two weeks.</p><button class="post-btn">Create</button></form>`);
  document.querySelector('#assignment-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    const { error } = await supabase.from('assignments').insert({ course_id: courseId, group_id: form.group_id.value || null, title: form.title.value.trim(), description: form.description.value.trim(), due_at: form.due_at.value ? new Date(form.due_at.value).toISOString() : null, status: form.status.value, counts_toward_selection_exam: form.counts.checked, created_by: currentUserId() });
    if (error) errorMessage(error); else { closeModal(); toast('Assignment created.', 'success'); await renderAdmin(); }
  });
}

async function reviewSubmission(id) {
  const { data, error } = await supabase.from('assignment_submissions').select('*,student:profiles!assignment_submissions_student_id_fkey(display_name),assignment:assignments(title)').eq('id', id).single();
  if (error) return errorMessage(error);
  showModal(`<h2>${e(data.assignment.title)}</h2><p><strong>${e(data.student.display_name)}</strong></p><div class="submission-content">${nl(data.content)}</div>${data.attachment_path ? '<button id="download-submission" class="text-button"><i class="fa-solid fa-download"></i> Download attachment</button>' : ''}<form id="review-form"><label>Feedback<textarea name="feedback" required>${e(data.feedback || '')}</textarea></label><label>Status<select name="status"><option value="reviewed">Reviewed</option><option value="returned">Return for changes</option></select></label><button class="post-btn">Save review</button></form>`);
  document.querySelector('#download-submission')?.addEventListener('click', async () => {
    const signed = await supabase.storage.from('assignment-files').createSignedUrl(data.attachment_path, 60, { download: true });
    if (signed.error) errorMessage(signed.error); else window.open(signed.data.signedUrl, '_blank', 'noopener');
  });
  document.querySelector('#review-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    const result = await supabase.from('assignment_submissions').update({ feedback: form.feedback.value.trim(), status: form.status.value, reviewed_by: currentUserId(), reviewed_at: new Date().toISOString() }).eq('id', id);
    if (result.error) errorMessage(result.error); else { closeModal(); toast('Review saved.', 'success'); await renderAdmin(); }
  });
}

async function manageUser(button) {
  if (button.dataset.user === currentUserId()) return toast('Manage your own role directly in Supabase to avoid locking yourself out.', 'error');
  const [{ data: groups, error: groupsError }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase.from('community_groups').select('id,name').order('name'),
    supabase.from('group_members').select('group_id').eq('user_id', button.dataset.user)
  ]);
  if (groupsError || membershipsError) return errorMessage(groupsError || membershipsError);
  const assigned = new Set(memberships.map(item => item.group_id));
  showModal(`<h2>Manage member</h2><form id="manage-user-form"><label>Role<select name="role"><option value="student" ${button.dataset.role === 'student' ? 'selected' : ''}>Student</option><option value="instructor" ${button.dataset.role === 'instructor' ? 'selected' : ''}>Instructor</option><option value="admin" ${button.dataset.role === 'admin' ? 'selected' : ''}>Admin</option></select></label><label class="checkbox"><input name="active" type="checkbox" ${button.dataset.active === 'true' ? 'checked' : ''}> Account active</label><fieldset class="member-picker"><legend>Groups</legend>${groups.length ? groups.map(group => `<label class="checkbox"><input name="groups" type="checkbox" value="${e(group.id)}" ${assigned.has(group.id) ? 'checked' : ''}> ${e(group.name)}</label>`).join('') : '<small>Create groups first.</small>'}</fieldset><button class="post-btn">Save</button></form>`);
  document.querySelector('#manage-user-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    try {
      const { error } = await supabase.from('profiles').update({ role: form.role.value, is_active: form.active.checked }).eq('id', button.dataset.user);
      if (error) throw error;
      const { error: removeError } = await supabase.from('group_members').delete().eq('user_id', button.dataset.user);
      if (removeError) throw removeError;
      const groupIds = [...form.querySelectorAll('[name=groups]:checked')].map(input => input.value);
      if (groupIds.length) {
        const { error: addError } = await supabase.from('group_members').insert(groupIds.map(group_id => ({ group_id, user_id: button.dataset.user })));
        if (addError) throw addError;
      }
      closeModal(); toast('Member updated.', 'success'); await renderAdmin();
    } catch (error) { errorMessage(error); }
  });
}

init();
