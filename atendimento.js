import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});
const TABLE = 'service_requests';
const PAGE_SIZE = 30;
const STATUS_LABELS = {
  new: 'Novo',
  in_progress: 'Em atendimento',
  quote_sent: 'Cotação enviada',
  waiting: 'Aguardando cliente',
  closed: 'Fechado',
  cancelled: 'Cancelado'
};
const CLASS_LABELS = {
  any: 'Todas as classes',
  economy: 'Econômica',
  premium: 'Premium economy',
  business: 'Executiva',
  first: 'Primeira classe'
};

const $ = (selector) => document.querySelector(selector);
const loginScreen = $('#login-screen');
const recoveryScreen = $('#recovery-screen');
const dashboardScreen = $('#dashboard-screen');
const headerActions = $('#header-actions');
const loginMessage = $('#login-message');
const recoveryMessage = $('#recovery-message');
const formMessage = $('#form-message');
const loginForm = $('#login-form');
const recoveryRequestForm = $('#recovery-request-form');
const passwordUpdateForm = $('#password-update-form');
const requestForm = $('#request-form');
const requestList = $('#request-list');
const searchInput = $('#request-search');
const statusFilter = $('#status-filter');
const returnDateInput = $('#return-date');
const tripTypeInput = $('#trip-type');
const childCountInput = $('#children-count');
const babyCountInput = $('#babies-count');

let currentUser = null;
let currentPage = 0;
let totalCount = 0;
let pageRequests = [];
let activeRequestId = null;

function setMessage(element, text, kind = 'info') {
  element.textContent = text;
  element.dataset.kind = kind;
  element.hidden = !text;
}

function showLogin(message = '') {
  loginScreen.hidden = false;
  recoveryScreen.hidden = true;
  dashboardScreen.hidden = true;
  headerActions.hidden = true;
  currentUser = null;
  if (message) setMessage(loginMessage, message, 'error');
}

function showRecovery({ updatePassword = false, firstPassword = false } = {}) {
  loginScreen.hidden = true;
  recoveryScreen.hidden = false;
  dashboardScreen.hidden = true;
  headerActions.hidden = true;
  $('#recovery-request-form').hidden = updatePassword;
  passwordUpdateForm.hidden = !updatePassword;
  $('#recovery-title').textContent = updatePassword
    ? (firstPassword ? 'Defina sua senha.' : 'Escolha uma nova senha.')
    : 'Vamos recuperar seu acesso.';
  $('#recovery-help').hidden = false;
  $('#recovery-help').textContent = updatePassword
    ? (firstPassword ? 'Crie uma senha individual para ativar seu acesso ao atendimento.' : 'Defina uma senha nova para a sua conta.')
    : 'Informe o e-mail da sua conta autorizada para receber as instruções de redefinição.';
}

function showDashboard(session) {
  currentUser = session.user;
  loginScreen.hidden = true;
  recoveryScreen.hidden = true;
  dashboardScreen.hidden = false;
  headerActions.hidden = false;
  $('#signed-in-email').textContent = currentUser.email || 'Equipe Alexia Travel';
  setMessage(loginMessage, '');
}

function normalizeWhatsAppNumber(value) {
  const raw = String(value || '').trim();
  const explicitlyInternational = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (explicitlyInternational) return digits.length >= 8 && digits.length <= 15 ? digits : '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if ((digits.length === 11 || digits.length === 12) && digits.startsWith('0')) digits = digits.slice(1);
  if ((digits.length === 13 || digits.length === 14) && digits.startsWith('0')) digits = digits.slice(3);
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  return '';
}

function formatShortDate(value) {
  if (!value) return 'Data a combinar';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function createElement(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

async function verifyAndEnter(session) {
  setMessage(loginMessage, 'Verificando seu acesso…');
  try {
    const { data: allowed, error } = await supabase.rpc('current_staff_access');
    if (error || allowed !== true) {
      await supabase.auth.signOut();
      showLogin('Este acesso ainda não está liberado para a equipe. Fale com a responsável pela Alexia Travel.');
      return;
    }
    showDashboard(session);
    currentPage = 0;
    await loadRequests();
  } catch {
    showLogin('Não foi possível validar o acesso agora. Tente novamente em instantes.');
  }
}

async function loadRequests() {
  const offset = currentPage * PAGE_SIZE;
  const columns = 'id,customer_name,customer_whatsapp,origin,destination,trip_type,departure_date,return_date,adults,child_ages,baby_ages,travel_class,customer_notes,status,assigned_to,follow_up_on,internal_notes,created_at,updated_at';
  let query = supabase
    .from(TABLE)
    .select(columns, { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (statusFilter.value !== 'all') query = query.eq('status', statusFilter.value);
  requestList.replaceChildren(createElement('p', 'empty-list', 'Carregando atendimentos…'));
  $('#refresh-button').disabled = true;

  try {
    const { data, error, count } = await query;
    if (error) throw error;
    pageRequests = data || [];
    totalCount = count || 0;
    renderRequests();
  } catch {
    pageRequests = [];
    totalCount = 0;
    requestList.replaceChildren(createElement('p', 'empty-list', 'Não foi possível carregar a fila. Atualize a página ou confirme sua autorização.'));
    $('#queue-summary').textContent = 'A fila não pôde ser carregada.';
    $('#previous-page').disabled = true;
    $('#next-page').disabled = true;
    $('#page-indicator').textContent = `Página ${currentPage + 1}`;
    $('#empty-editor').hidden = false;
    requestForm.hidden = true;
  } finally {
    $('#refresh-button').disabled = false;
  }
}

function renderRequests() {
  const term = searchInput.value.trim().toLocaleLowerCase('pt-BR');
  const visibleRequests = pageRequests.filter((request) => {
    if (!term) return true;
    const haystack = [request.customer_name, request.customer_whatsapp, request.origin, request.destination]
      .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    return haystack.includes(term);
  });

  const first = totalCount ? currentPage * PAGE_SIZE + 1 : 0;
  const last = Math.min((currentPage + 1) * PAGE_SIZE, totalCount);
  $('#queue-summary').textContent = totalCount ? `${first}–${last} de ${totalCount} atendimento${totalCount === 1 ? '' : 's'}` : 'Nenhum atendimento cadastrado';
  $('#page-indicator').textContent = `Página ${currentPage + 1}`;
  $('#previous-page').disabled = currentPage === 0;
  $('#next-page').disabled = (currentPage + 1) * PAGE_SIZE >= totalCount;
  requestList.replaceChildren();

  if (visibleRequests.length === 0) {
    const message = pageRequests.length && term
      ? 'Nenhum resultado nesta página. Limpe a busca ou navegue pela fila.'
      : 'Ainda não há atendimentos aqui. Use “Novo atendimento” para registrar um contato.';
    requestList.append(createElement('p', 'empty-list', message));
    return;
  }

  for (const request of visibleRequests) {
    const card = createElement('button', 'request-card');
    card.type = 'button';
    card.dataset.id = request.id;
    card.setAttribute('aria-current', String(request.id === activeRequestId));

    const head = createElement('div', 'request-card-head');
    head.append(createElement('span', 'request-card-name', request.customer_name));
    const status = createElement('span', 'status-pill', STATUS_LABELS[request.status] || 'Novo');
    status.dataset.status = request.status;
    head.append(status);

    const route = createElement('p', 'request-card-route', `${request.origin} → ${request.destination}`);
    const foot = createElement('div', 'request-card-foot');
    foot.append(createElement('span', '', formatShortDate(request.departure_date)));
    foot.append(createElement('span', '', request.follow_up_on ? `Retorno ${formatShortDate(request.follow_up_on)}` : 'Sem retorno marcado'));
    card.append(head, route, foot);
    card.addEventListener('click', () => selectRequest(request));
    requestList.append(card);
  }
}

function renderAgeFields(container, count, label, min, max, values = []) {
  container.replaceChildren();
  const safeCount = Math.max(0, Math.min(Number(count) || 0, 8));
  for (let index = 0; index < safeCount; index += 1) {
    const unit = label === 'Criança' ? 'anos' : 'meses';
    const wrapper = createElement('label', 'age-field', `${label} ${index + 1} — idade em ${unit}`);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.required = true;
    input.inputMode = 'numeric';
    input.dataset.ageKind = label === 'Criança' ? 'child' : 'baby';
    input.value = values[index] === undefined || values[index] === null ? '' : String(values[index]);
    input.setAttribute('aria-label', `${label} ${index + 1}, idade em ${unit}`);
    wrapper.append(input);
    container.append(wrapper);
  }
}

function updateAgeInputs() {
  const children = Array.from($('#child-ages').querySelectorAll('input')).map((input) => input.value);
  const babies = Array.from($('#baby-ages').querySelectorAll('input')).map((input) => input.value);
  renderAgeFields($('#child-ages'), childCountInput.value, 'Criança', 2, 11, children);
  renderAgeFields($('#baby-ages'), babyCountInput.value, 'Bebê', 0, 23, babies);
}

function updateTripType() {
  const isOneWay = tripTypeInput.value === 'one_way';
  $('#return-date-field').hidden = isOneWay;
  returnDateInput.required = !isOneWay;
  returnDateInput.disabled = isOneWay;
  if (isOneWay) returnDateInput.value = '';
}

function updateWhatsAppLink(request) {
  const phone = normalizeWhatsAppNumber(request.customer_whatsapp);
  const link = $('#whatsapp-link');
  if (!phone) {
    link.hidden = true;
    link.removeAttribute('href');
    return;
  }
  link.href = `https://wa.me/${phone}`;
  link.hidden = false;
}

function selectRequest(request) {
  activeRequestId = request.id;
  $('#empty-editor').hidden = true;
  requestForm.hidden = false;
  $('#editor-title').textContent = 'Editar atendimento';
  $('#customer-name').value = request.customer_name || '';
  $('#customer-whatsapp').value = request.customer_whatsapp || '';
  $('#origin').value = request.origin || '';
  $('#destination').value = request.destination || '';
  tripTypeInput.value = request.trip_type || 'round_trip';
  $('#travel-class').value = request.travel_class || 'any';
  $('#departure-date').value = request.departure_date || '';
  returnDateInput.value = request.return_date || '';
  $('#adults-count').value = String(request.adults || 1);
  childCountInput.value = String((request.child_ages || []).length);
  babyCountInput.value = String((request.baby_ages || []).length);
  renderAgeFields($('#child-ages'), childCountInput.value, 'Criança', 2, 11, request.child_ages || []);
  renderAgeFields($('#baby-ages'), babyCountInput.value, 'Bebê', 0, 23, request.baby_ages || []);
  $('#request-status').value = request.status || 'new';
  $('#assigned-to').value = request.assigned_to || '';
  $('#follow-up-on').value = request.follow_up_on || '';
  $('#customer-notes').value = request.customer_notes || '';
  $('#internal-notes').value = request.internal_notes || '';
  $('#departure-date').dispatchEvent(new Event('change'));
  updateTripType();
  updateWhatsAppLink(request);
  setMessage(formMessage, '');
  renderRequests();
}

function startNewRequest() {
  activeRequestId = null;
  requestForm.reset();
  $('#adults-count').value = '1';
  childCountInput.value = '0';
  babyCountInput.value = '0';
  $('#request-status').value = 'new';
  renderAgeFields($('#child-ages'), 0, 'Criança', 2, 11);
  renderAgeFields($('#baby-ages'), 0, 'Bebê', 0, 23);
  updateTripType();
  $('#editor-title').textContent = 'Novo atendimento';
  $('#empty-editor').hidden = true;
  requestForm.hidden = false;
  $('#whatsapp-link').hidden = true;
  setMessage(formMessage, '');
  renderRequests();
  $('#customer-name').focus();
}

function collectRequest() {
  const childAges = Array.from($('#child-ages').querySelectorAll('input')).map((input) => Number(input.value));
  const babyAges = Array.from($('#baby-ages').querySelectorAll('input')).map((input) => Number(input.value));
  return {
    customer_name: $('#customer-name').value.trim(),
    customer_whatsapp: $('#customer-whatsapp').value.trim(),
    origin: $('#origin').value.trim(),
    destination: $('#destination').value.trim(),
    trip_type: tripTypeInput.value,
    departure_date: $('#departure-date').value,
    return_date: tripTypeInput.value === 'one_way' ? null : ($('#return-date').value || null),
    adults: Number($('#adults-count').value),
    child_ages: childAges,
    baby_ages: babyAges,
    travel_class: $('#travel-class').value,
    customer_notes: $('#customer-notes').value.trim() || null,
    status: $('#request-status').value,
    assigned_to: $('#assigned-to').value.trim() || null,
    follow_up_on: $('#follow-up-on').value || null,
    internal_notes: $('#internal-notes').value.trim() || null
  };
}

async function saveRequest(event) {
  event.preventDefault();
  if (!currentUser) {
    showLogin('Entre novamente para continuar.');
    return;
  }
  if (!requestForm.reportValidity()) return;
  if (tripTypeInput.value === 'round_trip' && returnDateInput.value < $('#departure-date').value) {
    setMessage(formMessage, 'A data de volta precisa ser igual ou posterior à data de ida.', 'error');
    return;
  }

  const button = $('#save-request-button');
  button.disabled = true;
  button.textContent = 'Salvando…';
  const payload = collectRequest();
  try {
    let result;
    if (activeRequestId) {
      result = await supabase.from(TABLE).update(payload).eq('id', activeRequestId).select('id').single();
    } else {
      result = await supabase.from(TABLE).insert(payload).select('id').single();
    }
    if (result.error) throw result.error;
    activeRequestId = result.data.id;
    setMessage(formMessage, 'Atendimento salvo. A equipe já pode acompanhar o próximo passo.', 'success');
    statusFilter.value = 'all';
    currentPage = 0;
    await loadRequests();
    const saved = pageRequests.find((item) => item.id === activeRequestId);
    if (saved) selectRequest(saved);
  } catch {
    setMessage(formMessage, 'Não foi possível salvar. Confira os campos e tente novamente.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar atendimento';
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-button');
  button.disabled = true;
  setMessage(loginMessage, 'Conferindo seus dados…');
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-password').value
    });
    if (error || !data.session) throw error || new Error('No session');
    await verifyAndEnter(data.session);
  } catch {
    setMessage(loginMessage, 'Não foi possível entrar. Confira o e-mail e a senha ou fale com a responsável.', 'error');
  } finally {
    button.disabled = false;
  }
});

$('#show-recovery-button').addEventListener('click', () => {
  $('#recovery-email').value = $('#login-email').value.trim();
  setMessage(recoveryMessage, '');
  showRecovery();
});
$('#back-to-login-button').addEventListener('click', () => {
  window.history.replaceState(null, '', window.location.pathname);
  showLogin();
  setMessage(recoveryMessage, '');
});

recoveryRequestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#recovery-button');
  button.disabled = true;
  try {
    const redirectTo = new URL('./atendimento.html', window.location.href).toString();
    const { error } = await supabase.auth.resetPasswordForEmail($('#recovery-email').value.trim(), { redirectTo });
    if (error) throw error;
    setMessage(recoveryMessage, 'Se a conta estiver autorizada, as instruções serão enviadas ao e-mail informado.', 'success');
  } catch {
    setMessage(recoveryMessage, 'Não foi possível solicitar a redefinição agora. Tente novamente mais tarde.', 'error');
  } finally {
    button.disabled = false;
  }
});

passwordUpdateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#new-password').value;
  if (password !== $('#confirm-password').value) {
    setMessage(recoveryMessage, 'As senhas não coincidem.', 'error');
    return;
  }
  const button = $('#password-update-button');
  button.disabled = true;
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    await supabase.auth.signOut();
    window.history.replaceState(null, '', window.location.pathname);
    showLogin('Senha atualizada. Entre com a nova senha.');
  } catch {
    setMessage(recoveryMessage, 'Não foi possível atualizar a senha. Solicite um novo link de recuperação.', 'error');
  } finally {
    button.disabled = false;
  }
});

$('#sign-out-button').addEventListener('click', async () => {
  await supabase.auth.signOut();
  pageRequests = [];
  requestList.replaceChildren();
  showLogin();
});
$('#new-request-button').addEventListener('click', startNewRequest);
$('#cancel-edit-button').addEventListener('click', () => {
  activeRequestId = null;
  requestForm.hidden = true;
  $('#empty-editor').hidden = false;
  setMessage(formMessage, '');
  renderRequests();
});
requestForm.addEventListener('submit', saveRequest);
$('#refresh-button').addEventListener('click', () => loadRequests());
searchInput.addEventListener('input', renderRequests);
statusFilter.addEventListener('change', () => { currentPage = 0; activeRequestId = null; requestForm.hidden = true; $('#empty-editor').hidden = false; loadRequests(); });
$('#previous-page').addEventListener('click', () => { if (currentPage > 0) { currentPage -= 1; activeRequestId = null; requestForm.hidden = true; $('#empty-editor').hidden = false; loadRequests(); } });
$('#next-page').addEventListener('click', () => { if ((currentPage + 1) * PAGE_SIZE < totalCount) { currentPage += 1; activeRequestId = null; requestForm.hidden = true; $('#empty-editor').hidden = false; loadRequests(); } });
childCountInput.addEventListener('input', updateAgeInputs);
babyCountInput.addEventListener('input', updateAgeInputs);
tripTypeInput.addEventListener('change', updateTripType);
$('#departure-date').addEventListener('change', () => {
  returnDateInput.min = $('#departure-date').value;
  if (returnDateInput.value && returnDateInput.value < $('#departure-date').value) returnDateInput.value = '';
});

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') showRecovery({ updatePassword: true });
  if (event === 'SIGNED_OUT') {
    currentUser = null;
    if (!window.location.hash.includes('type=recovery')) showLogin();
  }
});

async function initialize() {
  const authLocation = `${window.location.search}${window.location.hash}`;
  if (authLocation.includes('type=recovery')) {
    showRecovery({ updatePassword: true });
    return;
  }
  if (authLocation.includes('type=invite')) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        showRecovery({ updatePassword: true, firstPassword: true });
      } else {
        showLogin('O convite expirou ou já foi usado. Solicite um novo link à responsável pela Alexia Travel.');
      }
    } catch {
      showLogin('Não foi possível abrir o convite agora. Solicite um novo link à responsável pela Alexia Travel.');
    }
    return;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await verifyAndEnter(session);
    else showLogin();
  } catch {
    showLogin('Não foi possível iniciar o painel. Atualize a página e tente novamente.');
  }
}

initialize();
