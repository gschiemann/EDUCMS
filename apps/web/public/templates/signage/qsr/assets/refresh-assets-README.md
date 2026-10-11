# QSR refresh assets

crew-kitchen.jpg is a stock workplace photograph downloaded 2026-10-11 from https://images.unsplash.com/photo-1556910103-1c02745aae4d (Unsplash license: https://unsplash.com/license). It illustrates a fictional recruitment example and is replaceable through hire.photo.

rewards-qr.js bundles the browser encoder from qrcode 1.5.4 (https://github.com/soldair/node-qrcode), with an exact MIT license in rewards-qr-LICENSE.txt. The bundle is also embedded inline in the rewards and hiring HTML so a saved template can generate its QR code without fetching a runtime script. Generated codes encode only the configured qr.url; empty or invalid URLs show editable counter guidance.
