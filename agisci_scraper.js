import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const PORT         = parseInt(process.env.PORT || '3000', 10);
// Environment variables must be set externally
const USER         = process.env.AGISC_USER;
const PASS         = process.env.AGISC_PASS;
const BASE_HOST    = process.env.BASE_URL;  // e.g. http://h20awihdtd00.risorse.enel/agisci_esercizio
const APP_API_KEY  = process.env.APP_API_KEY;

if (!USER || !PASS || !BASE_HOST || !APP_API_KEY) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const SEL = {
  tecnicoEnel:       '#l_reperibili',
  numeroTel:         '#t_recapiti',
  descrizione:       '#t_attivita',
  localita:          '#t_luogo_esec',
  azienda:           '#t_esecutrice',
  incaricatoImpresa: '#t_incaricato',
  preposto:          '#t_preposto',
  contratti:         '#l_contratti',
  zone:              '#l_zone',
  t_assegn:          '#t_assegn',
  t_dtora_termst:    '#t_dtora_termst'
};

let browser, context;

async function initBrowser() {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    ignoreHTTPSErrors: true,
    httpCredentials: { username: USER, password: PASS }
  });
  console.log('✅ Browser session initialized with Basic Auth');
  console.log('🔍 Using BASE_HOST =', BASE_HOST);
}

function detailUrl(num) {
  return `${BASE_HOST}/Interventi/Apertura.aspx?funz=GESTIONE&num=${encodeURIComponent(num)}` +
         `&pageprec=/agisci_esercizio/Interventi/Lista.aspx`;
}

async function scrapeData(numero) {
  const url = detailUrl(numero);
  console.log(`➡️ Navigating to: ${url}`);

  const page = await context.newPage();
  // Load frameset page
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for right frame element
  await page.waitForSelector('frame[name="right"]', { timeout: 30000 });
  // Override its src to the detail URL
  await page.evaluate(src => {
    const f = document.querySelector('frame[name="right"]');
    if (f) f.src = src;
  }, url);

  // Allow new frame to load
  await page.waitForTimeout(2000);
  // Find the frame now pointing to Apertura.aspx
  const detailFrame = page.frames().find(f => f.url().includes('Apertura.aspx'));
  if (!detailFrame) {
    throw new Error('Detail frame not found after src override');
  }

  // Wait for selectors inside the detail frame
  await Promise.all(
    Object.values(SEL).map(sel => detailFrame.waitForSelector(sel, { timeout: 30000 }))
  );

  // Extract data from the detail frame
  const data = { numero };
  data.tecnicoEnel       = await detailFrame.$eval(SEL.tecnicoEnel, el => el.options[el.selectedIndex]?.text.split('(')[0].trim());
  data.numeroTel         = await detailFrame.inputValue(SEL.numeroTel);
  data.descrizione       = await detailFrame.inputValue(SEL.descrizione);
  data.localita          = await detailFrame.inputValue(SEL.localita);
  data.azienda           = await detailFrame.inputValue(SEL.azienda);
  data.incaricatoImpresa = await detailFrame.inputValue(SEL.incaricatoImpresa);
  data.preposto          = await detailFrame.inputValue(SEL.preposto);

  if (await detailFrame.$(SEL.contratti)) {
    data.contratti = await detailFrame.$eval(SEL.contratti, el => el.options[el.selectedIndex]?.text.trim());
  }
  if (await detailFrame.$(SEL.zone)) {
    data.zone = await detailFrame.$eval(SEL.zone, el => el.options[el.selectedIndex]?.text.trim());
  }
  data.t_assegn       = await detailFrame.inputValue(SEL.t_assegn).catch(() => null);
  data.t_dtora_termst = await detailFrame.inputValue(SEL.t_dtora_termst).catch(() => null);

  await page.close();
  return data;
}

function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.sendStatus(200));

  app.post('/scrape', async (req, res) => {
    if (req.headers['x-api-key'] !== APP_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const numero = req.body.numero;
    if (!numero) {
      return res.status(400).json({ error: 'Missing "numero"' });
    }
    try {
      const result = await scrapeData(numero.trim());
      res.json(result);
    } catch (err) {
      console.error('❌ Scrape error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, '0.0.0.0', () =>
    console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`)
  );
}

(async () => {
  await initBrowser();
  const args = process.argv.slice(2);
  if (args[0] === 'test' && args[1]) {
    try {
      const output = await scrapeData(args[1]);
      console.log(JSON.stringify(output, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('Test error:', err);
      process.exit(1);
    }
  } else {
    startServer();
  }
})();
