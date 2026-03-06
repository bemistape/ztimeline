import { bootstrap } from "./src/main.js";

bootstrap().catch((error) => {
  console.error(error);
  const app = document.getElementById("app");
  if (!app) {
    return;
  }
  app.innerHTML = `
    <section class="fatal-state">
      <p class="fatal-eyebrow">Archive Unavailable</p>
      <h1>Unable to load the redesigned site.</h1>
      <p>${error instanceof Error ? error.message : "Unknown error."}</p>
      <p><a href="/index_v1.html">Open the preserved legacy build</a></p>
    </section>
  `;
});
