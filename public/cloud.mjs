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
    let user;
    let role;
    let roleListener;
    let authVersion = 0;

    const isSuper = () => role === 'superadmin';
    const editable = row => isSuper() || role === 'editor' && row.owner === user?.uid;
    const showError = error => { $('admin-message').textContent = error.message; };
    const run = action => async event => {
      const control = event?.submitter ?? event?.currentTarget;
      if (control) control.disabled = true;
      try { await action(event); }
      catch (error) { showError(error); }
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

    function manager(name, heading) {
      const section = el('section', null, {class: 'manager'});
      const form = el('form', null);
      const title = field(form, 'Nombre', 'title', 'text', 100);
      let date, location, details, url, record;
      if (name === 'events') {
        date = field(form, 'Fecha y hora (Santiago)', 'date', 'datetime-local', 24);
        location = field(form, 'Lugar y dirección', 'location', 'text', 200);
        details = field(form, 'Detalles', 'details', 'text', 1000, false);
        url = field(form, 'Enlace de inscripción', 'url', 'url', 500, false);
      } else {
        form.append(el('p', 'Al guardar se publica la lista actual del deckbuilder.'));
      }
      const submit = el('button', 'Publicar', {type: 'submit'});
      const reset = button('Cancelar edición', () => { record = undefined; form.reset(); submit.textContent = 'Publicar'; reset.hidden = true; });
      reset.hidden = true;
      form.append(submit, reset);
      form.onsubmit = run(async event => {
        event.preventDefault();
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
          if (!builder.valid(payload.cards)) throw new Error('Completa una baraja válida antes de publicar.');
        }
        if (record) await db.updateDoc(ref(name, record.id), payload);
        else await db.addDoc(collection(name), payload);
        reset.click();
        $('admin-message').textContent = 'Publicación guardada.';
      });
      const list = el('div', null);
      list.id = name + '-management';
      list.update = () => list.replaceChildren(...rows[name].map(row => {
        const line = el('div', null, {class: 'deck-row'});
        line.append(el('span', name === 'events' ? row.title + ' · ' + venueTime.format(row.startAt) : row.title));
        if (!editable(row)) return line;
        line.append(button('Editar', () => {
          if (name === 'decks' && Object.keys(builder.snapshot()).length &&
              !confirm('¿Cargar esta baraja y reemplazar el borrador?')) return;
          record = row;
          title.value = row.title;
          if (name === 'events') {
            date.value = localInput(row.startAt);
            location.value = row.location;
            details.value = row.details;
            url.value = row.url;
          } else builder.load(row.cards);
          reset.hidden = false;
          submit.textContent = 'Guardar cambios';
          title.focus();
        }), button('Eliminar', run(async () => {
          if (confirm('¿Eliminar «' + row.title + '»?')) {
            await db.deleteDoc(ref(name, row.id));
            if (record?.id === row.id) reset.click();
          }
        })));
        return line;
      }));
      section.append(el('h3', heading), form, el('h4', name === 'decks' ? 'Barajas publicadas' : 'Torneos publicados'), list);
      list.update();
      return section;
    }

    function renderAdmin() {
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
      const decks = el('section', null);
      const builderSlot = el('div', null, {id: 'admin-builder'});
      if (!$('administracion').hidden) builderSlot.append($('deck-builder'));
      decks.append(el('h3', 'Deckbuilder'), builderSlot, manager('decks', 'Publicar una baraja'));
      addPanel('Barajas', decks);
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
        form.append(el('button', 'Conceder acceso', {type: 'submit'}), button('Revocar acceso', run(async () => {
          await db.deleteDoc(target());
          message.textContent = 'Acceso revocado.';
        })));
        addPanel('Usuarios', form);
      }
      admin.append(controls, ...panels.map(({panel}) => panel));
    }

    for (const name of Object.keys(rows)) db.onSnapshot(collection(name), result => {
      rows[name] = result.docs.map(item => ({...item.data(), id: item.id})).sort((a, b) => a.title.localeCompare(b.title, 'es'));
      renderPublic();
      $(name + '-management')?.update();
    }, () => {
      if (name === 'events') events.textContent = 'No se pudieron cargar los torneos.';
      else $('public-status').textContent = 'No se pudieron cargar las barajas.';
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
