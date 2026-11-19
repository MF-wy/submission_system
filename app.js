const apiBase = 'http://127.0.0.1:8001';
const byId = id => document.getElementById(id);
const dialog = byId('dialog');
const dialogContent = byId('dialog-content');
let role = 'author';
let viewVersion = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, action, className) {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function message(id, text = '') {
  const node = byId(id);
  node.textContent = text;
  node.hidden = !text;
}

async function api(path, method = 'GET', data) {
  const response = await fetch(apiBase + path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (response.status === 204) return;
  const result = await response.json();
  if (!response.ok) {
    throw new Error(typeof result.detail === 'string' ? result.detail : '請填寫所有欄位並確認字數。');
  }
  return result;
}

const statusLabels = { draft: '編輯中', review: '審查中', approved: '已通過' };

async function render() {
  const version = ++viewVersion;
  const isAuthor = role === 'author';
  byId('author').setAttribute('aria-pressed', isAuthor);
  byId('editor').setAttribute('aria-pressed', !isAuthor);
  byId('page-title').textContent = isAuthor ? '我的投稿' : '待審查稿件';
  byId('page-description').textContent = isAuthor
    ? '建立草稿、送出投稿並查看審查結果。'
    : '閱讀稿件，決定通過或退回修改。';
  byId('new-paper').hidden = !isAuthor;
  byId('approved-author-column').hidden = isAuthor;
  const columns = isAuthor ? ['類別', '標題', '狀態', '操作'] : ['作者', '類別', '標題', '操作'];
  byId('columns').replaceChildren(...columns.map(label => {
    const cell = element('th', label);
    cell.scope = 'col';
    return cell;
  }));
  const empty = byId('empty');
  const approvedEmpty = byId('approved-empty');
  byId('papers').replaceChildren();
  byId('approved-papers').replaceChildren();
  empty.hidden = false;
  empty.textContent = '載入中…';
  approvedEmpty.hidden = false;
  approvedEmpty.textContent = '載入中…';
  try {
    const papers = await api(isAuthor ? '/papers?role=author' : '/papers?role=editor&include_approved=true');
    if (version !== viewVersion) return;
    const mainPapers = papers.filter(paper => paper.status !== 'approved');
    const approved = papers.filter(paper => paper.status === 'approved');
    empty.hidden = mainPapers.length > 0;
    empty.textContent = isAuthor ? '目前沒有編輯中或審查中的稿件。' : '目前沒有待審查稿件。';
    byId('papers').replaceChildren(...mainPapers.map(paper => makeRow(paper, isAuthor)));
    approvedEmpty.hidden = approved.length > 0;
    approvedEmpty.textContent = '目前沒有已通過稿件。';
    byId('approved-papers').replaceChildren(...approved.map(paper => makeRow(paper, isAuthor)));
  } catch {
    if (version === viewVersion) {
      empty.textContent = '無法載入稿件，請確認 FastAPI 和 PostgreSQL 已啟動。';
      approvedEmpty.textContent = '無法載入已通過稿件。';
    }
  }
}

function makeRow(paper, isAuthor) {
  const row = document.createElement('tr');
  if (!isAuthor) row.append(element('td', paper.author));
  row.append(element('td', paper.category), element('td', paper.title));
  if (isAuthor && paper.status !== 'approved') {
    const status = row.insertCell();
    status.append(element('span', statusLabels[paper.status], 'badge ' + paper.status));
    if (paper.returned) status.append(element('span', '已退回', 'returned'));
  }
  const actions = element('div', '', 'actions');
  const canReview = !isAuthor && paper.status === 'review';
  actions.append(button(canReview ? '審查' : '查看', () => showPaper(paper, canReview)));
  if (isAuthor && paper.status === 'draft') {
    actions.append(
      button('編輯', () => paperForm(paper)),
      button('送出', () => {
        if (confirm('確定送出這篇稿件？')) save('/papers/' + paper.id + '/submit', 'POST', undefined, '已送出投稿。');
      }, 'primary'),
      button('刪除', () => {
        if (confirm('確定刪除這篇草稿？')) save('/papers/' + paper.id, 'DELETE', undefined, '已刪除草稿。');
      }, 'danger'),
    );
  }
  row.insertCell().append(actions);
  return row;
}

function openDialog(title, ...nodes) {
  byId('dialog-title').textContent = title;
  dialogContent.replaceChildren(...nodes);
  message('dialog-feedback');
  if (!dialog.open) dialog.showModal();
}

function showPaper(paper, canReview) {
  const meta = element('p', paper.author + ' ・ ' + paper.category, 'meta');
  const article = element('div', paper.content, 'article');
  const nodes = [meta, article];
  if (paper.return_reason) nodes.push(element('p', '退回理由：' + paper.return_reason, 'reason'));
  if (canReview) {
    const actions = element('p', '', 'actions');
    actions.append(
      button('通過', event => save('/papers/' + paper.id + '/approve', 'POST', undefined, '稿件已通過。', event.currentTarget), 'primary'),
      button('退回稿件', () => returnForm(paper), 'danger'),
    );
    nodes.push(actions);
  }
  openDialog(paper.title, ...nodes);
}

function field(label, name, value = '', multiline = false) {
  const wrapper = element('label', label);
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.name = name;
  input.value = value;
  input.required = true;
  const maxLengths = { category: 100, title: 200, content: 20000, reason: 20000 };
  input.maxLength = maxLengths[name];
  if (multiline) input.rows = 7;
  wrapper.append(input);
  return wrapper;
}

function buildForm(label, fields, onSubmit) {
  const form = element('form', '', 'fields');
  const submit = element('button', label, 'primary');
  submit.type = 'submit';
  form.append(...fields, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(data)) data[key] = data[key].trim();
    if (Object.values(data).some(value => !value)) {
      message('dialog-feedback', '所有欄位都必須填寫。');
      return;
    }
    onSubmit(data, submit);
  });
  return form;
}

function paperForm(paper) {
  const form = buildForm('儲存草稿', [
    field('類別', 'category', paper?.category),
    field('標題', 'title', paper?.title),
    field('文章內容', 'content', paper?.content, true),
  ], (data, submit) => save(
    paper ? '/papers/' + paper.id : '/papers', paper ? 'PUT' : 'POST', data, '已儲存草稿。', submit
  ));
  const notes = paper?.return_reason
    ? [element('p', '退回理由：' + paper.return_reason, 'reason')]
    : [];
  openDialog(paper ? '編輯投稿' : '新增投稿', ...notes, form);
}

function returnForm(paper) {
  const form = buildForm('確認退回', [field('退回理由', 'reason', '', true)],
    (data, submit) => save('/papers/' + paper.id + '/return', 'POST', data, '稿件已退回。', submit));
  openDialog('退回稿件', element('p', paper.title, 'meta'), form);
}

async function save(path, method, data, success, trigger) {
  const feedback = dialog.open ? 'dialog-feedback' : 'feedback';
  if (trigger) trigger.disabled = true;
  message(feedback);
  try {
    await api(path, method, data);
    if (dialog.open) dialog.close();
    message('feedback', success);
    await render();
  } catch (error) {
    message(feedback, error instanceof TypeError ? '無法連線到 FastAPI，請確認服務已啟動。' : error.message);
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

for (const name of ['author', 'editor']) {
  byId(name).addEventListener('click', () => {
    role = name;
    message('feedback');
    render();
  });
}
byId('new-paper').addEventListener('click', () => paperForm());
render();
