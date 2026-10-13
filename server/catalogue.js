// @ts-check
// What the website sells through server/kit (sign in with Google, Stripe Checkout and its
// webhook): one "Support this app" payment and nothing else. It changes nothing in the app. A
// paid checkout grants the entitlement `supporter`, which `GET api/me` then reports, and the About
// dialog thanks a supporter for it (js/account.js). Its Stripe Price id is STRIPE_PRICE_SUPPORTER;
// without that variable nothing is sold.
//
// The kit checks this at start-up and throws on a malformed one (an unknown field included), and
// test/api.test.mjs holds it to what js/account.js asks for.

export default {
  app: 'ambientnoiser',
  name: 'Ambient Noiser',
  products: [
    {
      id: 'supporter',
      name: 'Support this app',
      description: 'A one-time payment towards Ambient Noiser. It changes nothing in the app: every style, texture, export and saved mix stays the same for everyone.',
      mode: 'payment',
      grants: 'supporter',
    },
  ],
};
