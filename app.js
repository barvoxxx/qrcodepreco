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
  updateDoc,
  writeBatch,
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
let editingProductId = null;
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

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value).trim().replace(/[R$\s]/g, "");
  if (!text) return null;

  let normalized = text;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isFinite(price) ? price : null;
}

function formatDate(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : timestamp instanceof Date ? timestamp : null;
  return date ? new Intl.DateTimeFormat("pt-BR").format(date) : "Agora";
}

function normalizeProductMatchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findProductByNameText(rawText) {
  if (!Array.isArray(products) || !products.length) return null;
  const normalizedInput = normalizeProductMatchText(rawText);
  if (!normalizedInput) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const product of products) {
    const normalizedName = normalizeProductMatchText(product.name);
    if (!normalizedName) continue;
    if (normalizedInput === normalizedName) return product;

    const containsName = normalizedInput.includes(normalizedName) || normalizedName.includes(normalizedInput);
    const inputTokens = normalizedInput.split(" ").filter(Boolean);
    const nameTokens = normalizedName.split(" ").filter(Boolean);
    const overlap = inputTokens.filter((token) => nameTokens.includes(token)).length;
    const score = containsName ? 100 : overlap;

    if (score > bestScore) {
      bestMatch = product;
      bestScore = score;
    }
  }

  if (bestMatch && bestScore >= 2) return bestMatch;
  return null;
}

async function readProductNameFromVideo() {
  if (!window.Tesseract || !products.length) return null;
  const video = document.querySelector("#qr-reader video");
  if (!video || video.readyState < 2) return null;

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const result = await window.Tesseract.recognize(canvas, "por+eng", { logger: () => {} });
  const detectedText = String(result?.data?.text ?? "");
  if (!detectedText.trim()) return null;

  return findProductByNameText(detectedText);
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
      <td class="product-actions">
        <button class="table-action-button" type="button" data-edit-product="${safeText(product.id)}">Editar</button>
        <button class="icon-button delete-button" type="button" data-delete-product="${safeText(product.id)}" aria-label="Excluir ${safeText(product.name)}" title="Excluir produto">×</button>
      </td>
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

function setProductResult(product, source = "QR") {
  $("#scan-placeholder").classList.add("hidden");
  $("#scan-product").classList.remove("hidden");
  const eyebrow = source === "NOME" ? "PRODUTO ENCONTRADO PELO NOME" : "PRODUTO ENCONTRADO";
  const meta = source === "NOME" ? "Identificado pelo nome do produto" : "Informações salvas no Firestore";
  $("#scan-product").innerHTML = `
    <span class="result-check">✓</span>
    <p class="eyebrow">${eyebrow}</p>
    <h3>${safeText(product.name)}</h3>
    <p class="result-price">${formatPrice(product.price)}</p>
    <p class="result-meta">${meta}</p>`;
}

function setScannedContent(content) {
  $("#scan-placeholder").classList.add("hidden");
  $("#scan-product").classList.remove("hidden");
  $("#scan-product").innerHTML = `
    <p class="eyebrow">QR CODE LIDO</p>
    <h3>Conteúdo do código</h3>
    <p class="result-qr-content">${safeText(content)}</p>`;
}

async function findScannedProduct(rawValue) {
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    setScannedContent(rawValue);
    return false;
  }
  const productId = url.searchParams.get("produto");
  const userId = url.searchParams.get("uid");
  if (!productId || !userId) {
    setScannedContent(rawValue);
    return false;
  }
  if (!currentUser) throw new Error("Entre na conta proprietária deste produto para consultar os dados.");
  if (currentUser.uid !== userId) throw new Error("Este produto pertence a outra conta. Entre com a conta que o cadastrou.");

  const snapshot = await getDoc(doc(db, "users", userId, "products", productId));
  if (!snapshot.exists()) throw new Error("Produto não encontrado. Ele pode ter sido excluído.");
  const product = { id: snapshot.id, ...snapshot.data() };
  setProductResult(product);
  return true;
}

async function startScanner() {
  if (scannerStarted) return;
  if (!window.Html5Qrcode) {
    $("#scanner-error").textContent = "O leitor de QR Code não carregou. Verifique sua conexão e recarregue a página.";
    $("#scanner-error").classList.remove("hidden");
    return;
  }
  $("#scanner-error").classList.add("hidden");
  scanner = new window.Html5Qrcode("qr-reader", {
    formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE],
  });
  try {
    await scanner.start(
      { facingMode: "environment" },
      {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.85);
          return { width: size, height: size };
        },
        videoConstraints: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          focusMode: { ideal: "continuous" },
        },
      },
      async (decodedText) => {
        await scanner.stop();
        scannerStarted = false;

        try {
          const productFound = await findScannedProduct(decodedText);
          if (productFound) return;
        } catch (error) {
          // Se a leitura do QR falhar, tenta identificar o produto pelo nome na imagem.
        }

        try {
          const productByName = await readProductNameFromVideo();
          if (productByName) {
            setProductResult(productByName, "NOME");
            return;
          }
        } catch (error) {
          // A OCR é opcional; o QR continua sendo a via principal.
        }

        if (decodedText && decodedText.trim()) {
          setScannedContent(decodedText);
        }

        $("#scanner-error").textContent = "Não foi possível ler o QR Code. Ajuste o foco da câmera e tente novamente ou aproxime o nome do produto.";
        $("#scanner-error").classList.remove("hidden");
        showToast("Não foi possível identificar o QR Code. Tente ler o nome do produto.");
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
  editingProductId = null;
  $("#product-form").reset();
  $("#product-modal-title").textContent = "Novo produto";
  $("#save-product-button").textContent = "Salvar e gerar QR";
  $("#product-error").classList.add("hidden");
  $("#product-modal").classList.remove("hidden");
  $("#product-name").focus();
});
$("#empty-new-button").addEventListener("click", () => $("#new-product-button").click());

$("#import-products-button").addEventListener("click", () => $("#import-products-file").click());

function normalizeHeader(value) {
  return String(value).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function importProducts(file) {
  if (!window.XLSX) throw new Error("A biblioteca de planilhas não carregou. Verifique sua conexão e recarregue a página.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("A planilha não contém nenhuma aba.");
  const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: "" });
  if (!rows.length) throw new Error("A planilha está vazia.");
  const headerRowIndex = rows.findIndex((row) => {
    const rowHeaders = row.map(normalizeHeader);
    return rowHeaders.includes("nome") && rowHeaders.includes("preco");
  });
  if (headerRowIndex < 0) throw new Error('Não encontrei as colunas "Nome" e "Preço" na planilha.');
  const headers = rows[headerRowIndex].map(normalizeHeader);
  const nameColumn = headers.indexOf("nome");
  const priceColumn = headers.indexOf("preco");

  const importedProducts = [];
  let skippedCount = 0;
  for (const row of rows.slice(headerRowIndex + 1)) {
    if (!row.some((cell) => String(cell).trim())) continue;
    const name = String(row[nameColumn] ?? "").trim();
    const price = parsePrice(row[priceColumn]);
    if (!name || name.length > 100 || price === null) {
      skippedCount += 1;
      continue;
    }
    importedProducts.push({ name, price });
  }
  if (!importedProducts.length) {
    throw new Error("Nenhum produto válido encontrado. Confira os nomes e preços da planilha.");
  }
  const skippedMessage = skippedCount ? ` ${skippedCount} linha(s) inválida(s) serão ignoradas.` : "";
  if (!window.confirm(`Importar ${importedProducts.length} produto(s)?${skippedMessage} Cada produto será adicionado ao catálogo com seu próprio QR Code.`)) {
    return;
  }

  let importedCount = 0;
  try {
    for (let offset = 0; offset < importedProducts.length; offset += 450) {
      const batch = writeBatch(db);
      const chunk = importedProducts.slice(offset, offset + 450);
      chunk.forEach((product) => {
        batch.set(doc(productCollection()), { ...product, createdAt: serverTimestamp() });
      });
      await batch.commit();
      importedCount += chunk.length;
    }
    await loadProducts();
    showToast(`${importedCount} produto(s) importado(s) com QR Code.`);
  } catch (error) {
    let refreshError = "";
    await loadProducts().catch((loadError) => {
      setConnection(false, "Erro ao atualizar");
      refreshError = ` O catálogo não pôde ser atualizado: ${loadError.message}`;
    });
    const message = importedCount
      ? `${importedCount} produto(s) foram importados antes da falha: ${error.message}.${refreshError}`
      : `Não foi possível importar os produtos: ${error.message}.${refreshError}`;
    showToast(message);
  }
}

$("#import-products-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  const button = $("#import-products-button");
  button.disabled = true;
  try {
    await importProducts(file);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#product-error").classList.add("hidden");
  const name = $("#product-name").value.trim();
  const price = parsePrice($("#product-price").value);
  if (!name || name.length > 100 || price === null) {
    $("#product-error").textContent = "Informe um nome (até 100 caracteres) e um preço válido igual ou maior que zero.";
    $("#product-error").classList.remove("hidden");
    return;
  }
  const button = $("#save-product-button");
  const productId = editingProductId;
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    if (productId) {
      await updateDoc(doc(db, "users", currentUser.uid, "products", productId), { name, price });
      products = products.map((product) => product.id === productId ? { ...product, name, price } : product);
    } else {
      const result = await addDoc(productCollection(), { name, price, createdAt: serverTimestamp() });
      const product = { id: result.id, name, price, createdAt: new Date() };
      products.unshift(product);
    }
    renderProducts();
    $("#product-modal").classList.add("hidden");
    if (productId) {
      showToast("Produto atualizado. O QR Code continua válido.");
    } else {
      openQrModal(products[0]);
      showToast("Produto salvo e QR Code gerado.");
    }
  } catch (error) {
    $("#product-error").textContent = `Não foi possível salvar no Firestore: ${error.message}`;
    $("#product-error").classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.textContent = editingProductId ? "Salvar alterações" : "Salvar e gerar QR";
  }
});

$("#products-table-body").addEventListener("click", async (event) => {
  const qrButton = event.target.closest("[data-show-qr]");
  if (qrButton) {
    const product = products.find((item) => item.id === qrButton.dataset.showQr);
    if (product) openQrModal(product);
    return;
  }
  const editButton = event.target.closest("[data-edit-product]");
  if (editButton) {
    const product = products.find((item) => item.id === editButton.dataset.editProduct);
    if (!product) return;
    editingProductId = product.id;
    $("#product-form").reset();
    $("#product-name").value = product.name;
    $("#product-price").value = String(product.price).replace(".", ",");
    $("#product-modal-title").textContent = "Editar produto";
    $("#save-product-button").textContent = "Salvar alterações";
    $("#product-error").classList.add("hidden");
    $("#product-modal").classList.remove("hidden");
    $("#product-name").focus();
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
$("#download-qr-button").addEventListener("click", async () => {
  if (!activeQrProduct) {
    showToast("Não foi possível gerar a imagem do QR Code.");
    return;
  }
  try {
    const qrContainer = document.createElement("div");
    createQrCode(qrContainer, qrUrl(activeQrProduct.id), 1024);
    const qrCanvas = qrContainer.querySelector("canvas");
    const qrImage = qrContainer.querySelector("img");
    if (!qrCanvas && !qrImage) throw new Error("A biblioteca não gerou a imagem do QR Code.");
    if (qrImage && !qrImage.complete) {
      await new Promise((resolve, reject) => {
        qrImage.addEventListener("load", resolve, { once: true });
        qrImage.addEventListener("error", () => reject(new Error("Não foi possível preparar a imagem do QR Code.")), { once: true });
      });
    }

    const sourceWidth = qrCanvas?.width || qrImage.naturalWidth;
    const sourceHeight = qrCanvas?.height || qrImage.naturalHeight;
    const quietZone = Math.ceil(Math.max(sourceWidth, sourceHeight) * 0.1);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = sourceWidth + quietZone * 2;
    exportCanvas.height = sourceHeight + quietZone * 2;
    const context = exportCanvas.getContext("2d");
    if (!context) throw new Error("Seu navegador não conseguiu preparar a imagem para download.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.drawImage(qrCanvas || qrImage, quietZone, quietZone, sourceWidth, sourceHeight);

    const link = document.createElement("a");
    link.href = exportCanvas.toDataURL("image/png");
    link.download = `qr-${activeQrProduct.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    link.click();
  } catch (error) {
    showToast(`Não foi possível gerar a imagem do QR Code: ${error.message}`);
  }
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
