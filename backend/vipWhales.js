/**
 * Manually-pinned VIP whale wallets (Monad) — always tracked, exempt from the
 * discovery bot-filter AND from roster cleanup, regardless of on-chain shape.
 * Some are legitimately smart-account (AA / 7702-delegated) wallets, so they
 * carry bytecode; that must NOT get them banned as "contracts". Shared by
 * listener.js (live roster) and cleanRoster.js (purge) so the two never drift.
 */
export const VIP_WHALES = new Set([
  '0x4cd934beae89200b3e5f16783897c9424e25f3df',
  '0xe1aa0010b4c25f38a7c8a724fdd79c6e8ce543fe',
  '0xe50f5af8a97379b6ebd968121186c71b88dc0b69',
  '0x69c350da1c843093aff7aae118af7fa73e7736f8',
  '0x15ddce897d76ac39c188ade4d353711a60395315',
  '0xa9615d22b2d1f8836d60fe7e1c13c56ec7a342e3',
  '0xe50585bd466bff569da0a1737b299fdb31aa368e',
  '0x33a458ea4cad5c7943f8ae2a58dc5dcd3bb2fb07',
  '0x5a8bcbdb13fdad13d622ffac3e30ea17eea06fed',
  '0x05ca0b7b8626ae142c90219cc3cf42faca0dd103',
  '0xa99767ff6874018935af8924eeb3de3c7b578edc',
  '0xb3a41293d166b21ccb8c61ae9011cbc7559d348f',
  '0x0f3f5ffc9f100c11335ac8b9e89dc91bb5f41c98',
  '0xb11e96e929c64cfe12c28f1c0417bb8ddaf5f6b6',
  '0x8524a3a88e9d9672b33e34de03e174f140ef6663',
  '0xbb34dab96850d0b453c1f984a81bb497efb229e7',
  '0x988d179a9e8a174cc92ebd51492281dd2f19fa9e',
  '0xc0ea1c03bb9d466d506c0fb1621f256e291c38e2',
  '0x17b04ada408086bb37743d8589e5e18c522be159',
  '0xb42f812a44c22cc6b861478900401ee759ebead6',
  '0xa581a60fdea3c390ff08f033733c6b678f5f9f49',
]);
