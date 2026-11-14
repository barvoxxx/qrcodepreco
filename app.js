import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (selector) => document.querySelector(selector);
const configReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const app = configReady ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

let currentUser = null;
let products = [];
let authMode = "login";
let scanner = null;
let scannerStarted = false;
let activeQrProduct = null;
let toastTimeout;

$("#today-date").textContent = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
}).format(new Date());

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}

function setConnection(connected, message) {
  $("#connection-text").textContent = message;
  $("#connection-indicator").classList.toggle("connected", connected);
}

function productCollection(userId = currentUser?.uid) {
  if (!db || !userId) throw new Error("Faça login para acessar os produtos.");
  return collection(db, "users", userId, "products");
}

function qrUrl(productId, userId = currentUser.uid) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("uid", userId);
  url.searchParams.set("produto", productId);
  return url.toString();
}

function formatPrice(price) {
  return Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : timestamp instanceof Date ? timestamp : null;
  return date ? new Intl.DateTimeFormat("pt-BR").format(date) : "Agora";
}

function safeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showAuthError(message) {
  const error = $("#auth-error");
  error.textContent = message;
  error.classList.remove("hidden");
}

function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "Este e-mail já está cadastrado. Tente entrar.",
    "auth/invalid-email": "Informe um e-mail válido.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
    "auth/operation-not-allowed": "Ative o método E-mail/senha no Firebase Authentication.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet e tente novamente.",
  };
  return messages[error.code] || `Não foi possível autenticar: ${error.message}`;
}

function renderAuthMode() {
  const creating = authMode === "register";
  $("#auth-title").textContent = creating ? "Crie sua conta" : "Entre na sua conta";
  $("#auth-submit").textContent = creating ? "Criar conta" : "Entrar";
  $("#auth-toggle-prompt").textContent = creating ? "Já tem uma conta?" : "Ainda não tem uma conta?";
  $("#auth-toggle").textContent = creating ? "Entrar" : "Criar conta";
  $("#auth-password").autocomplete = creating ? "new-password" : "current-password";
  $("#auth-error").classList.add("hidden");
}

async function loadProducts() {
  if (!currentUser) return;
  setConnection(true, "Conectado ao Firestore");
  const snapshot = await getDocs(productCollection());
  products = snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });
  renderProducts();
}

function renderProducts() {
  const query = $("#search-input").value.trim().toLocaleLowerCase("pt-BR");
  const filtered = products.filter((product) => product.name.toLocaleLowerCase("pt-BR").includes(query));
  $("#product-count").textContent = String(products.length).padStart(2, "0");
  $("#qr-count").textContent = String(products.length).padStart(2, "0");
  $("#empty-state").classList.toggle("visible", filtered.length === 0);
  $("#empty-state h3").textContent = products.length && query ? "Nenhum resultado encontrado" : "Nenhum produto por aqui";
  $("#empty-state p").textContent = products.length && query
    ? "Tente buscar usando outro nome."
    : "Adicione seu primeiro produto para gerar um QR Code.";
  $("#products-table-body").innerHTML = filtered.map((product) => `
    <tr>
      <td><div class="product-cell"><span class="product-thumbnail">${safeText(product.name.trim().charAt(0).toUpperCase())}</span><span class="product-name">${safeText(product.name)}</span></div></td>
      <td><span class="price-cell">${formatPrice(product.price)}</span></td>
      <td><button class="qr-mini-button" type="button" data-show-qr="${safeText(product.id)}"><span class="qr-mini-pattern">▦</span> Ver QR Code</button></td>
      <td><span class="date-cell">${formatDate(product.createdAt)}</span></td>
      <td><button class="icon-button delete-button" type="button" data-delete-product="${safeText(product.id)}" aria-label="Excluir ${safeText(product.name)}" title="Excluir produto">⋯</button></td>
    </tr>`).join("");
}

function createQrCode(container, value, size = 210) {
  container.replaceChildren();
  if (!window.QRCode) throw new Error("A biblioteca de QR Code não carregou. Recarregue a página.");
  new window.QRCode(container, {
    text: value,
    width: size,
    height: size,
    colorDark: "#142018",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.H,
  });
}

function openQrModal(product) {
  activeQrProduct = product;
  $("#qr-modal-title").textContent = product.name;
  $("#qr-modal-description").textContent = formatPrice(product.price);
  createQrCode($("#qr-display"), qrUrl(product.id));
  $("#qr-modal").classList.remove("hidden");
}

function setProductResult(product) {
  $("#scan-placeholder").classList.add("hidden");
  $("#scan-product").classList.remove("hidden");
  $("#scan-product").innerHTML = `
    <span class="result-check">✓</span>
    <p class="eyebrow">PRODUTO ENCONTRADO</p>
    <h3>${safeText(product.name)}</h3>
    <p class="result-price">${formatPrice(product.price)}</p>
    <p class="result-meta">Informações salvas no Firestore</p>`;
}

async function findScannedProduct(rawValue) {
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("Este QR Code não contém um link de produto válido.");
  }
  const productId = url.searchParams.get("produto");
  const userId = url.searchParams.get("uid");
  if (!productId || !userId) throw new Error("Este QR Code não pertence a um produto do Preço QR.");
  if (!currentUser) throw new Error("Entre na conta proprietária deste produto para consultar os dados.");
  if (currentUser.uid !== userId) throw new Error("Este produto pertence a outra conta. Entre com a conta que o cadastrou.");

  const snapshot = await getDoc(doc(db, "users", userId, "products", productId));
  if (!snapshot.exists()) throw new Error("Produto não encontrado. Ele pode ter sido excluído.");
  const product = { id: snapshot.id, ...snapshot.data() };
  setProductResult(product);
}

async function startScanner() {
  if (scannerStarted) return;
  if (!window.Html5Qrcode) {
    $("#scanner-error").textContent = "O leitor de QR Code não carregou. Verifique sua conexão e recarregue a página.";
    $("#scanner-error").classList.remove("hidden");
    return;
  }
  $("#scanner-error").classList.add("hidden");
  scanner = new window.Html5Qrcode("qr-reader");
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
      async (decodedText) => {
        await scanner.stop();
        scannerStarted = false;
        try {
          await findScannedProduct(decodedText);
        } catch (error) {
          $("#scanner-error").textContent = error.message;
          $("#scanner-error").classList.remove("hidden");
          showToast(error.message);
        }
      },
      () => {},
    );
    scannerStarted = true;
  } catch (error) {
    $("#scanner-error").textContent = `Não foi possível abrir a câmera: ${error.message}. Confira a permissão e use localhost ou HTTPS.`;
    $("#scanner-error").classList.remove("hidden");
  }
}

async function stopScanner() {
  if (scanner && scannerStarted) {
    await scanner.stop();
    scannerStarted = false;
  }
}

function activateView(viewName, launchCamera = true) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === viewName));
  $(`#${viewName}-view`).classList.add("active");
  $("#breadcrumb-current").textContent = viewName === "products" ? "Produtos" : "Ler QR Code";
  if (viewName === "scanner" && launchCamera) startScanner();
  else stopScanner().catch((error) => showToast(`Não foi possível fechar a câmera: ${error.message}`));
}

function setAuthVisibility(user) {
  currentUser = user;
  $("#auth-overlay").classList.toggle("hidden", Boolean(user));
  $("#account-row").classList.toggle("hidden", !user);
  if (!user) {
    products = [];
    renderProducts();
    setConnection(false, configReady ? "Desconectado" : "Configure o Firebase");
    return;
  }
  $("#account-email").textContent = user.email || "Conta";
  $("#account-avatar").textContent = (user.email || "U").charAt(0).toUpperCase();
  loadProducts().catch((error) => {
    setConnection(false, "Erro ao carregar");
    showToast(`Não foi possível carregar os produtos: ${error.message}`);
  });
  const productId = new URLSearchParams(window.location.search).get("produto");
  const targetUid = new URLSearchParams(window.location.search).get("uid");
  if (productId && targetUid === user.uid) {
    activateView("scanner", false);
    findScannedProduct(window.location.href).catch((error) => {
      $("#scanner-error").textContent = error.message;
      $("#scanner-error").classList.remove("hidden");
    });
  }
}

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#auth-error").classList.add("hidden");
  if (!auth) return;
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  $("#auth-submit").disabled = true;
  try {
    if (authMode === "register") await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showAuthError(friendlyAuthError(error));
  } finally {
    $("#auth-submit").disabled = false;
  }
});

$("#auth-toggle").addEventListener("click", () => {
  authMode = authMode === "login" ? "register" : "login";
  renderAuthMode();
});

$("#logout-button").addEventListener("click", () => {
  signOut(auth).catch((error) => showToast(`Não foi possível sair: ${error.message}`));
});

$("#new-product-button").addEventListener("click", () => {
  $("#product-form").reset();
  $("#product-error").classList.add("hidden");
  $("#product-modal").classList.remove("hidden");
  $("#product-name").focus();
});
$("#empty-new-button").addEventListener("click", () => $("#new-product-button").click());

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#product-error").classList.add("hidden");
  const name = $("#product-name").value.trim();
  const price = Number($("#product-price").value);
  if (!name || !Number.isFinite(price) || price <= 0) {
    $("#product-error").textContent = "Informe um nome e um preço maior que zero.";
    $("#product-error").classList.remove("hidden");
    return;
  }
  const button = $("#save-product-button");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const result = await addDoc(productCollection(), { name, price, createdAt: serverTimestamp() });
    const product = { id: result.id, name, price, createdAt: new Date() };
    products.unshift(product);
    renderProducts();
    $("#product-modal").classList.add("hidden");
    openQrModal(product);
    showToast("Produto salvo e QR Code gerado.");
  } catch (error) {
    $("#product-error").textContent = `Não foi possível salvar no Firestore: ${error.message}`;
    $("#product-error").classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = "Salvar e gerar QR";
  }
});

$("#products-table-body").addEventListener("click", async (event) => {
  const qrButton = event.target.closest("[data-show-qr]");
  if (qrButton) {
    const product = products.find((item) => item.id === qrButton.dataset.showQr);
    if (product) openQrModal(product);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-product]");
  if (!deleteButton) return;
  const product = products.find((item) => item.id === deleteButton.dataset.deleteProduct);
  if (!product || !window.confirm(`Excluir "${product.name}"? O QR Code deixará de abrir o produto.`)) return;
  deleteButton.disabled = true;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "products", product.id));
    products = products.filter((item) => item.id !== product.id);
    renderProducts();
    showToast("Produto excluído.");
  } catch (error) {
    deleteButton.disabled = false;
    showToast(`Não foi possível excluir o produto: ${error.message}`);
  }
});

$("#search-input").addEventListener("input", renderProducts);
document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => activateView(button.dataset.view));
});
document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => button.closest(".modal-backdrop").classList.add("hidden"));
});
document.querySelectorAll(".modal-backdrop").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  });
});
$("#download-qr-button").addEventListener("click", () => {
  const canvas = $("#qr-display canvas");
  const image = $("#qr-display img");
  const source = canvas?.toDataURL("image/png") || image?.src;
  if (!source || !activeQrProduct) {
    showToast("Não foi possível gerar a imagem do QR Code.");
    return;
  }
  const link = document.createElement("a");
  link.href = source;
  link.download = `qr-${activeQrProduct.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  link.click();
});

if (configReady) {
  onAuthStateChanged(auth, setAuthVisibility, (error) => {
    setConnection(false, "Erro de autenticação");
    showToast(`Falha na autenticação Firebase: ${error.message}`);
  });
} else {
  $("#auth-overlay").classList.remove("hidden");
  $("#auth-title").textContent = "Configure o Firebase";
  $(".auth-description").textContent = "Adicione as credenciais do seu projeto em firebase-config.js para conectar o catálogo.";
  $("#auth-form").classList.add("hidden");
  $(".auth-toggle-copy").classList.add("hidden");
  $(".auth-footnote").textContent = "Consulte o README.md para configurar o Firebase Authentication, Firestore e as regras de acesso.";
  setConnection(false, "Configure o Firebase");
}
