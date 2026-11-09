import config from './firebase-config.mjs';
import { $, el, button } from './ui.mjs';

const version = 'https://www.gstatic.com/firebasejs/11.10.0/firebase-';
const venueTime = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago'
});

export async function connect(builder) {
  const admin = $('admin');
  const events = $('events');
  if (!config) {
    $('public-status').textContent = 'Las barajas publicadas estarán disponibles al conectar Firebase.';
    events.textContent = 'La agenda estará disponible al conectar Firebase.';
    admin.textContent = 'La administración requiere configurar Firebase.';
    return;
  }
  try {
    const [app, auth, db] = await Promise.all(['app', 'auth', 'firestore'].map(name => import(version + name + '.js')));
    const client = app.initializeApp(config);
    const login = auth.getAuth(client);
    const store = db.getFirestore(client);
    const ref = (name, id) => db.doc(store, name, id);
    const collection = name => db.collection(store, name);
    const rows = {decks: [], events: []};
    let deckListState = 'loading';
    let user;
    let role;
    let roleListener;
    let editorsListener;
    let authVersion = 0;

    const isSuper = () => role === 'superadmin';
    const editable = row => isSuper() || role === 'editor' && row.owner === user?.uid;
    const showError = error => { $('admin-message').textContent = error.message; };
    const run = (action, report = showError) => async event => {
      const control = event?.submitter ?? event?.currentTarget;
      if (control) control.disabled = true;
      try { await action(event); }
      catch (error) { report(error); }
      finally { if (control) control.disabled = false; }
    };

    function renderPublic() {
      const select = $('presets');
      const old = select.value;
      select.replaceChildren(el('option', 'Selecciona una baraja', {value: ''}),
        ...rows.decks.map(row => el('option', row.title, {value: row.id})));
      select.value = rows.decks.some(row => row.id === old) ? old : '';
      $('load-preset').disabled = !select.value;
      $('public-status').textContent = rows.decks.length ? '' : 'Aún no hay barajas publicadas.';
      const upcoming = rows.events.filter(row => row.startAt > Date.now()).sort((a, b) => a.startAt - b.startAt);
      events.replaceChildren(...upcoming.map(row => {
        const tile = el('article', null);
        tile.append(el('b', venueTime.format(row.startAt) + ' · hora de Santiago'),
          el('h3', row.title), el('p', row.location), el('p', row.details));
        if (/^https?:\/\//i.test(row.url)) tile.append(el('a', 'Información e inscripción ↗', {href: row.url}));
        return tile;
      }));
      if (!upcoming.length) events.append(el('p', 'Aún no hay torneos próximos anunciados.'));
    }

    $('presets').onchange = () => { $('load-preset').disabled = !$('presets').value; };
    $('load-preset').onclick = () => {
      const row = rows.decks.find(item => item.id === $('presets').value);
      if (row && (!Object.keys(builder.snapshot()).length || confirm('¿Reemplazar el borrador por esta baraja?')))
        builder.load(row.cards);
    };

    function field(form, label, name, type, maxlength, required = true) {
      const wrapper = el('label', label);
      const input = el('input', null, {name, type, maxlength});
      input.required = required;
      wrapper.append(input);
      form.append(wrapper);
      return input;
    }

    function manager(name, heading, builderSlot) {
      const section = el('section', null, {class: 'manager'});
      const editor = el('div', null);
      const library = el('div', null);
      const editorHeading = el('h3', heading, {tabindex: '-1'});
      const listHeading = el('h3', builderSlot ? 'Barajas publicadas' : 'Torneos publicados', {tabindex: '-1'});
      const form = el('form', null, builderSlot ? {id: 'deck-publish-form'} : {});
      const feedback = el('p', null, {role: 'status'});
      const libraryStatus = el('p', null, {role: 'status'});
      const title = field(form, 'Nombre', 'title', 'text', 100);
      let date, location, details, url, record;
      let previousDraft;
      function showDeckEditor(open) {
        library.hidden = open;
        editor.hidden = !open;
        (open ? editorHeading : listHeading).focus();
      }
      if (name === 'events') {
        date = field(form, 'Fecha y hora (Santiago)', 'date', 'datetime-local', 24);
        location = field(form, 'Lugar y dirección', 'location', 'text', 200);
        details = field(form, 'Detalles', 'details', 'text', 1000, false);
        url = field(form, 'Enlace de inscripción', 'url', 'url', 500, false);
      } else {
        form.append(el('p', 'Agrega de 1 a 60 cartas. Al publicar, la lista aparecerá en el Deckbuilder público.'));
      }
      const publishLabel = builderSlot ? 'Publicar baraja' : 'Publicar';
      const submit = el('button', publishLabel, {type: 'submit', class: 'primary'});
      function resetEditor() {
        if (previousDraft) builder.load(previousDraft);
        previousDraft = undefined;
        record = undefined;
        form.reset();
        editorHeading.textContent = heading;
        submit.textContent = publishLabel;
        reset.hidden = true;
        feedback.textContent = '';
      }
      const reset = button('Cancelar edición', () => {
        if (builderSlot && !confirm('¿Volver al listado y descartar los cambios de esta baraja?')) return;
        resetEditor();
        if (builderSlot) showDeckEditor(false);
        else feedback.textContent = 'Edición cancelada.';
      });
      reset.hidden = true;
      if (builderSlot) {
        submit.setAttribute('form', form.id);
        if (builderSlot.contains($('deck-builder'))) {
          const actions = $('print').parentElement;
          actions.insertBefore(submit, $('clear'));
          actions.after(feedback);
          submit.dataset.adminDeckControl = '';
          feedback.dataset.adminDeckControl = '';
        }
      } else form.append(submit, reset);
      form.onsubmit = run(async event => {
        event.preventDefault();
        feedback.textContent = '';
        const payload = {title: title.value.trim(), owner: record?.owner ?? user.uid};
        if (!payload.title) throw new Error('Escribe un nombre.');
        if (name === 'events') {
          const startAt = santiagoTime(date.value);
          if (!Number.isFinite(startAt)) throw new Error('La hora no existe en Santiago. Elige otra.');
          if (!location.value.trim()) throw new Error('Escribe el lugar del torneo.');
          if (url.value && !/^https?:\/\//i.test(url.value)) throw new Error('Usa un enlace http o https.');
          Object.assign(payload, {startAt, location: location.value.trim(), details: details.value.trim(), url: url.value.trim()});
        } else {
          payload.cards = builder.snapshot();
          const total = Object.values(payload.cards).reduce((sum, quantity) => sum + quantity, 0);
          if (total < 1 || total > 60) throw new Error('La lista debe tener entre 1 y 60 cartas.');
        }
        const editing = Boolean(record);
        section.inert = true;
        try {
          if (record) await db.updateDoc(ref(name, record.id), payload);
          else await db.addDoc(collection(name), payload);
        } finally {
          section.inert = false;
        }
        resetEditor();
        const success = editing ? 'Cambios guardados en «' + payload.title + '».' : '«' + payload.title + '» se publicó.';
        if (builderSlot) {
          if (!editing) builder.load({});
          libraryStatus.textContent = success;
          showDeckEditor(false);
        } else feedback.textContent = success;
      }, error => { feedback.textContent = error.message; });
      const list = el('div', null);
      list.id = name + '-management';
      const search = el('input', null, {type: 'search', 'aria-label': 'Buscar barajas publicadas', placeholder: 'Buscar por nombre'});
      const normalizeTitle = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();
      list.update = () => {
        const visible = builderSlot
          ? rows.decks.filter(row => normalizeTitle(row.title).includes(normalizeTitle(search.value)))
          : rows.events;
        if (!visible.length) {
          const empty = builderSlot ? {
            loading: 'Cargando barajas…',
            error: 'No se pudieron cargar las barajas.',
            loaded: rows.decks.length ? 'No hay barajas que coincidan con la búsqueda.' : 'Aún no hay barajas publicadas.'
          }[deckListState] : 'Aún no hay torneos publicados.';
          list.replaceChildren(el('p', empty, {class: 'muted'}));
          return;
        }
        list.replaceChildren(...visible.map(row => {
          const line = el('div', null, {class: 'deck-row'});
          const detail = builderSlot
            ? Object.values(row.cards ?? {}).reduce((sum, quantity) => sum + quantity, 0) + ' cartas'
            : venueTime.format(row.startAt);
          line.append(el('span', row.title + ' · ' + detail));
          if (!editable(row)) return line;
          line.append(button('Editar', () => {
            if (record?.id === row.id) {
              editorHeading.focus();
              return;
            }
            if (record && !confirm('¿Descartar los cambios y editar «' + row.title + '»?')) return;
            if (builderSlot && !record) previousDraft = builder.snapshot();
            record = row;
            title.value = row.title;
            if (name === 'events') {
              date.value = localInput(row.startAt);
              location.value = row.location;
              details.value = row.details;
              url.value = row.url;
            } else builder.load(row.cards, true);
            reset.hidden = false;
            feedback.textContent = '';
            editorHeading.textContent = 'Editando «' + row.title + '»';
            submit.textContent = 'Guardar cambios';
            if (builderSlot) showDeckEditor(true);
            else editorHeading.focus();
          }), button('Eliminar', run(async () => {
            if (confirm('¿Eliminar «' + row.title + '»?')) {
              await db.deleteDoc(ref(name, row.id));
              if (record?.id === row.id) resetEditor();
            }
          })));
          return line;
        }));
      };
      editor.append(editorHeading);
      editor.append(form);
      if (builderSlot) {
        const create = button('Nueva baraja', () => {
          libraryStatus.textContent = '';
          showDeckEditor(true);
        });
        create.classList.add('primary');
        const back = button('Volver al listado', () => {
          if (record) reset.click();
          else showDeckEditor(false);
        });
        editor.prepend(back);
        editor.append(builderSlot);
        editor.classList.add('admin-deck-editor');
        section.classList.add('admin-decks');
        editor.hidden = true;
        reset.hidden = true;
        search.oninput = list.update;
        const actions = el('div', null, {class: 'actions'});
        actions.append(create, search);
        library.append(listHeading, actions, libraryStatus, list);
        section.append(library, editor);
      } else {
        editor.append(feedback);
        section.append(editor, listHeading, list);
      }
      list.update();
      return section;
    }

    function renderAdmin() {
      editorsListener?.();
      editorsListener = undefined;
      $('deck-builder').querySelectorAll('[data-admin-deck-control]').forEach(control => control.remove());
      const message = el('p', null, {id: 'admin-message', role: 'status'});
      $('public-builder').append($('deck-builder'));
      admin.replaceChildren(message);
      if (!user) {
        admin.append(button('Entrar con Google', run(() => auth.signInWithPopup(login, new auth.GoogleAuthProvider()))));
        return;
      }
      admin.append(el('p', 'UID de acceso: ' + user.uid), button('Cerrar sesión', run(() => auth.signOut(login))));
      if (!isSuper() && role !== 'editor') {
        admin.append(el('p', 'Comparte tu UID con el superadministrador para recibir acceso.'));
        return;
      }
      const controls = el('div', null, {class: 'actions', role: 'group', 'aria-label': 'Secciones de administración'});
      const panels = [];
      function addPanel(label, panel) {
        const control = button(label, () => {
          for (const item of panels) {
            item.panel.hidden = item.panel !== panel;
            item.control.setAttribute('aria-pressed', String(item.panel === panel));
          }
        });
        panel.hidden = panels.length > 0;
        control.setAttribute('aria-pressed', String(!panel.hidden));
        controls.append(control);
        panels.push({control, panel});
      }
      const builderSlot = el('div', null, {id: 'admin-builder'});
      if (!$('administracion').hidden) builderSlot.append($('deck-builder'));
      addPanel('Barajas', manager('decks', 'Crear una baraja', builderSlot));
      addPanel('Torneos', manager('events', 'Programar torneos'));
      if (isSuper()) {
        const form = el('form', null, {class: 'manager'});
        form.append(el('h3', 'Permisos de administrador'));
        const uid = field(form, 'UID del usuario', 'uid', 'text', 128);
        const target = () => {
          const value = uid.value.trim();
          if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value) || value === user.uid) throw new Error('Ingresa el UID de otro usuario.');
          return ref('roles', value);
        };
        form.onsubmit = run(async event => {
          event.preventDefault();
          await db.setDoc(target(), {role: 'editor'});
          message.textContent = 'Acceso concedido.';
        });
        form.append(el('button', 'Conceder acceso', {type: 'submit'}));
        const list = el('ul', null, {'aria-label': 'Usuarios con acceso'});
        const listStatus = el('p', 'Cargando usuarios…', {role: 'status'});
        const panel = el('section', null, {class: 'manager'});
        panel.append(form, el('h4', 'Usuarios con acceso'), listStatus, list);
        addPanel('Usuarios', panel);
        const editors = db.query(collection('roles'), db.where('role', '==', 'editor'));
        editorsListener = db.onSnapshot(editors, result => {
          listStatus.textContent = result.empty ? 'Aún no hay editores con acceso.' : '';
          list.replaceChildren(...result.docs.map(({id}) => {
            const row = el('li', null, {class: 'deck-row'});
            row.append(el('span', id), button('Revocar acceso', run(async () => {
              if (!confirm('¿Revocar el acceso de ' + id + '?')) return;
              await db.deleteDoc(ref('roles', id));
              message.textContent = 'Acceso revocado.';
            })));
            return row;
          }));
        }, () => {
          list.replaceChildren();
          listStatus.textContent = 'No se pudieron cargar los usuarios con acceso.';
        });
      }
      admin.append(controls, ...panels.map(({panel}) => panel));
    }

    for (const name of Object.keys(rows)) db.onSnapshot(collection(name), result => {
      if (name === 'decks') deckListState = 'loaded';
      rows[name] = result.docs.map(item => ({...item.data(), id: item.id})).sort((a, b) => a.title.localeCompare(b.title, 'es'));
      renderPublic();
      $(name + '-management')?.update();
    }, () => {
      if (name === 'events') events.textContent = 'No se pudieron cargar los torneos.';
      else {
        deckListState = 'error';
        $('public-status').textContent = 'No se pudieron cargar las barajas.';
        $('decks-management')?.update();
      }
    });

    auth.onAuthStateChanged(login, current => {
      roleListener?.();
      user = current;
      role = undefined;
      const version = ++authVersion;
      renderAdmin();
      if (user) roleListener = db.onSnapshot(ref('roles', user.uid), result => {
        if (version !== authVersion) return;
        role = result.data()?.role;
        renderAdmin();
      }, showError);
    });
  } catch {
    admin.textContent = 'No se pudo conectar con Firebase.';
    events.textContent = 'No se pudo cargar la agenda.';
  }
}

const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const localInput = value => clock.format(value).replace(' ', 'T');
function santiagoTime(value) {
  const utc = Date.parse(value + ':00Z');
  for (const hours of [3, 4]) {
    const candidate = utc + hours * 3600000;
    if (Number.isFinite(candidate) && localInput(candidate) === value) return candidate;
  }
  return NaN;
}
