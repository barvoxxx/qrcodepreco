# Preço QR

Sistema web para cadastrar produtos, salvar nome e preço no Cloud Firestore, gerar um QR Code individual para cada produto e consultar os dados pela câmera.

## 1. Configurar o Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Adicione um aplicativo Web e copie os dados de configuração.
3. Cole esses dados nos campos correspondentes de [firebase-config.js](./firebase-config.js). A configuração do Firebase para Web identifica o projeto; a proteção dos dados é feita pelas regras do Firestore.
4. Em **Authentication → Sign-in method**, habilite **E-mail/senha**.
5. Em **Firestore Database**, crie um banco de dados e publique estas regras:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/products/{productId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Cada conta só consegue ler e alterar os próprios produtos. Crie uma conta pela tela inicial do sistema para começar a usar.

## 2. Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie os arquivos deste projeto para ele. O `index.html` deve ficar na raiz do repositório.
2. No repositório, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**, escolha a branch `main` e a pasta `/ (root)`, depois clique em **Save**.
4. Aguarde a publicação e abra o endereço indicado pelo GitHub Pages. Ele será parecido com `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
5. No Firebase Console, abra **Authentication → Settings → Authorized domains** e adicione o domínio do site, por exemplo `SEU-USUARIO.github.io` (sem `https://` e sem o caminho do repositório). Se usar domínio próprio, adicione esse domínio também.

O arquivo [firebase-config.js](./firebase-config.js) contém a configuração pública do aplicativo Web Firebase. Ela será incluída no repositório e pode ser vista por qualquer pessoa; isso é esperado para aplicativos Web. **Não coloque senhas, chaves privadas ou credenciais de servidor nesse arquivo.** A segurança dos produtos depende das regras do Firestore acima e da autenticação, não de esconder a configuração.

Para testar antes de publicar, abra a pasta no VS Code e inicie um servidor local com uma extensão como **Live Server**. Não abra `index.html` diretamente como arquivo: os módulos Firebase precisam ser servidos por HTTP e os navegadores só permitem o acesso à câmera em **localhost** ou em um site com **HTTPS**.

## 3. Usar os QR Codes

- Clique em **Novo produto**, informe nome e preço e salve. O produto será gravado no Firestore e o QR Code será exibido.
- Use **Editar** na lista para alterar nome ou preço. O QR Code existente continua válido e passa a mostrar os dados atualizados.
- Clique em **Importar produtos** para selecionar uma planilha `.xlsx`, `.xls` ou `.csv`. A primeira aba deve ter colunas chamadas **Nome** e **Preço** (acentos e maiúsculas não são obrigatórios). Cada linha válida é adicionada como um novo produto e recebe seu próprio QR Code; linhas sem nome ou com preço inválido são ignoradas. São aceitos preços com vírgula ou ponto decimal, inclusive valores como `0,00`, `0.0` e `000`. A importação não substitui produtos que já estão no catálogo.
- Em **Ver QR Code**, abra ou baixe a etiqueta PNG de qualquer produto cadastrado. O arquivo baixado é gerado em alta resolução e inclui margem branca para facilitar a impressão e a leitura.
- Na seção **Ler QR Code**, permita o acesso à câmera e aponte-a para uma etiqueta. O produto aparece no resultado após a leitura.
- Para abrir a etiqueta em outro aparelho, publique no GitHub Pages e gere/baixe o QR Code pelo endereço HTTPS publicado. Os códigos gerados no endereço local de teste apontam para esse endereço local, então gere novas etiquetas após publicar. A leitura requer login na mesma conta que cadastrou o produto e acesso à câmera no navegador.

As bibliotecas Firebase, QRCode.js e html5-qrcode são carregadas por CDN; é necessária conexão com a internet para carregar a aplicação.
