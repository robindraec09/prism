# Prism

**One open-source TypeScript tool for UI, API and performance testing.**

Write a test once and run it on Chrome, Firefox, an Android emulator, an iPhone simulator or a cloud device. Seed data through your API in the same test. Turn the same API flow into a load test for 1,000 virtual users.

> **Status:** early development (phase 0 — foundations). Nothing is published to npm yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Planned features

- **UI testing:** web (Chromium over CDP, Firefox over WebDriver BiDi), native Android, native iOS and hybrid apps, with our own drivers — no Selenium, Playwright or Appium underneath.
- **API testing:** REST, GraphQL, WebSocket, schema and contract checks, auth helpers.
- **Performance testing:** load, stress and soak tests from your API code; Core Web Vitals and mobile app metrics.
- **Built in:** auto-waiting, self-healing locators, visual snapshots, Gherkin/BDD, HTML/JUnit/Allure reports, emulator and simulator management, cloud device farms.

```ts
import { test, expect, by } from 'prismtest';

test('order shows in the app', async ({ api, app }) => {
  const order = await api.post('/orders', { json: { sku: 'TSHIRT-M', qty: 2 } }).json();
  await app.signInWith(api.session);
  await app.tap(by.text('My orders'));
  await expect(app.find(by.text(order.id))).toBeVisible();
});
```

## Project docs

- [Product requirements](docs/PRD.md)
- [Roadmap and tasks](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)

## Licence

[MIT](LICENSE)
