import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, deleteUser, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, query, where, getDocs, doc,
  writeBatch, updateDoc, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Same Firebase project as the app, with a separate Web app
// registration so this page has its own client config. Mirrors the
// app's own deletion sequence exactly: wipe every row in every group
// only if this is the household's last member, otherwise just leave, then
// delete the sign-in itself. The household document is never deleted, by
// the same rule the app follows.
const firebaseConfig = {
  projectId: "clovie-b60de",
  appId: "1:899324941004:web:4edb8e65128ff7c3b0e869",
  storageBucket: "clovie-b60de.firebasestorage.app",
  apiKey: "AIzaSyBuyBXSz2nOOSRp8LCOtx-fAPbtVOeb_aE",
  authDomain: "clovie-b60de.firebaseapp.com",
  messagingSenderId: "899324941004",
};

const SYNC_COLLECTIONS = [
  'events', 'shopping', 'pantry', 'cycles', 'workouts', 'routines',
  'customExercises', 'weighIns', 'recipes', 'messages', 'foodItems',
  'foodLog', 'nutritionGoals',
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const els = {
  start: document.getElementById('ssStart'),
  google: document.getElementById('ssGoogle'),
  emailForm: document.getElementById('ssEmailForm'),
  email: document.getElementById('ssEmail'),
  password: document.getElementById('ssPassword'),
  error: document.getElementById('ssError'),
  confirm: document.getElementById('ssConfirm'),
  who: document.getElementById('ssWho'),
  scope: document.getElementById('ssScope'),
  confirmInput: document.getElementById('ssConfirmInput'),
  confirmBtn: document.getElementById('ssConfirmBtn'),
  cancelBtn: document.getElementById('ssCancelBtn'),
  working: document.getElementById('ssWorking'),
  done: document.getElementById('ssDone'),
};

let pendingHouseholds = [];

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = '';
}

async function afterSignIn(user) {
  clearError();
  const snap = await getDocs(
    query(collection(db, 'households'), where('memberUids', 'array-contains', user.uid)),
  );
  pendingHouseholds = snap.docs.map((d) => ({ id: d.id, data: d.data() }));

  els.who.textContent = `Sessão iniciada como ${user.email || user.uid}.`;
  const alone = pendingHouseholds.length === 0
    || pendingHouseholds.every((h) => (h.data.memberUids || []).length <= 1);
  els.scope.textContent = alone
    ? 'Tens sessão iniciada sozinho, por isso eliminar a tua conta também limpa tudo no teu espaço partilhado.'
    : 'Alguém continua emparelhado contigo. A cópia dessa pessoa do espaço partilhado fica exatamente como está, só o teu lugar e a tua sessão são removidos.';

  els.start.hidden = true;
  els.confirm.hidden = false;
}

els.google.addEventListener('click', async () => {
  clearError();
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    await afterSignIn(result.user);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user') return;
    showError('Não foi possível iniciar sessão com o Google. Tenta novamente.');
  }
});

els.emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  try {
    const result = await signInWithEmailAndPassword(auth, els.email.value.trim(), els.password.value);
    await afterSignIn(result.user);
  } catch (e2) {
    showError('Esse email e palavra-passe não correspondem a nenhuma conta. Confirma-os, ou usa o Google se foi assim que te registaste.');
  }
});

els.confirmInput.addEventListener('input', () => {
  els.confirmBtn.disabled = els.confirmInput.value.trim().toUpperCase() !== 'DELETE';
});

els.cancelBtn.addEventListener('click', async () => {
  await signOut(auth).catch(() => {});
  location.reload();
});

els.confirmBtn.addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return;
  els.confirm.hidden = true;
  els.working.hidden = false;
  try {
    for (const household of pendingHouseholds) {
      const members = household.data.memberUids || [];
      const remaining = members.filter((uid) => uid !== user.uid);
      if (remaining.length === 0) {
        for (const group of SYNC_COLLECTIONS) {
          const rows = await getDocs(collection(db, 'households', household.id, group));
          const ids = rows.docs.map((d) => d.id);
          for (let i = 0; i < ids.length; i += 450) {
            const batch = writeBatch(db);
            for (const id of ids.slice(i, i + 450)) {
              batch.delete(doc(db, 'households', household.id, group, id));
            }
            await batch.commit();
          }
        }
      }
      await updateDoc(doc(db, 'households', household.id), {
        memberUids: arrayRemove(user.uid),
      });
    }
    await deleteUser(user);
    els.working.hidden = true;
    els.done.hidden = false;
  } catch (err) {
    els.working.hidden = true;
    els.confirm.hidden = false;
    if (err.code === 'auth/requires-recent-login') {
      showError('Por segurança, recarrega esta página, inicia sessão de novo, e confirma logo a seguir.');
    } else {
      showError('Algo correu mal. É seguro tentar de novo, ou envia um email para hello@clovie.eu se persistir.');
    }
  }
});
