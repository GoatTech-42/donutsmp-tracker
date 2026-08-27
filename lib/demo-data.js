const ITEMS = [
  ['Totem of Undying', 740000, 'minecraft:totem_of_undying'],
  ['Netherite Ingot', 4850000, 'minecraft:netherite_ingot'],
  ['Netherite Scrap', 1050000, 'minecraft:netherite_scrap'],
  ['Diamond Block', 31000, 'minecraft:diamond_block'],
  ['Diamond', 3400, 'minecraft:diamond'],
  ['Elytra', 7900000, 'minecraft:elytra'],
  ['Enchanted Golden Apple', 760000, 'minecraft:enchanted_golden_apple'],
  ['Beacon', 132000, 'minecraft:beacon'],
  ['Obsidian', 2900, 'minecraft:obsidian'],
  ['End Crystal', 31500, 'minecraft:end_crystal'],
  ['Shulker Shell', 94000, 'minecraft:shulker_shell'],
  ['Gunpowder', 820, 'minecraft:gunpowder'],
  ['TNT', 6100, 'minecraft:tnt'],
  ['Redstone', 680, 'minecraft:redstone'],
  ['Redstone Block', 5900, 'minecraft:redstone_block'],
  ['Iron Ingot', 310, 'minecraft:iron_ingot'],
  ['Iron Block', 3100, 'minecraft:iron_block'],
  ['Gold Ingot', 540, 'minecraft:gold_ingot'],
  ['Gold Block', 5200, 'minecraft:gold_block'],
  ['Emerald', 870, 'minecraft:emerald'],
  ['Oak Log', 165, 'minecraft:oak_log'],
  ['Oak Planks', 55, 'minecraft:oak_planks'],
  ['Sugar Cane', 120, 'minecraft:sugar_cane'],
  ['Paper', 48, 'minecraft:paper'],
  ['Blaze Rod', 6200, 'minecraft:blaze_rod'],
  ['Ender Pearl', 780, 'minecraft:ender_pearl'],
  ['Eye of Ender', 4800, 'minecraft:ender_eye'],
  ['Nether Star', 118000, 'minecraft:nether_star'],
  ['Experience Bottle', 8700, 'minecraft:experience_bottle'],
  ['Golden Apple', 14000, 'minecraft:golden_apple']
];

function rng(seed) {
  let value = seed >>> 0;
  return () => ((value = Math.imul(1664525, value) + 1013904223 >>> 0) / 4294967296);
}

function demoAuctions(seed = 42) {
  const random = rng(seed);
  const rows = [];
  ITEMS.forEach(([name, base, id], itemIndex) => {
    const listings = 5 + Math.floor(random() * 9);
    for (let index = 0; index < listings; index++) {
      const count = base < 10000 ? [1, 8, 16, 32, 64][Math.floor(random() * 5)] : 1;
      const unit = Math.max(1, Math.round(base * (0.82 + random() * 0.42) * (index === 0 && itemIndex % 7 === 0 ? 0.68 : 1)));
      rows.push({
        id: `demo-${itemIndex}-${index}`,
        seller: { name: ['AxolotlAce', 'VoidTrader', 'QuartzKing', 'MangoPvP', 'RedstoneRay'][Math.floor(random() * 5)] },
        price: unit * count,
        pricePerUnit: unit,
        count,
        itemName: name,
        itemId: id,
        timeLeft: Math.floor((15 + random() * 280) * 60000),
        item: { id, count, display_name: name }
      });
    }
  });
  return rows;
}

function demoTransactions(seed = 84) {
  const random = rng(seed);
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 420; i++) {
    const [name, base, id] = ITEMS[Math.floor(random() * ITEMS.length)];
    const count = base < 10000 ? [1, 8, 16, 32, 64][Math.floor(random() * 5)] : 1;
    const unit = Math.max(1, Math.round(base * (0.88 + random() * 0.24)));
    rows.push({
      id: `sale-${i}`,
      seller: { name: ['AxolotlAce', 'VoidTrader', 'QuartzKing', 'MangoPvP', 'RedstoneRay'][Math.floor(random() * 5)] },
      buyer: { name: ['Steve', 'Alex', 'CopperCat', 'SMPWhale'][Math.floor(random() * 4)] },
      price: unit * count,
      pricePerUnit: unit,
      count,
      itemName: name,
      itemId: id,
      dateSold: now - Math.floor(random() * 7 * 86400000),
      item: { id, count, display_name: name }
    });
  }
  return rows.sort((a, b) => b.dateSold - a.dateSold);
}

function demoLeaderboard(type, page = 1) {
  const names = ['MangoPvP', 'VoidTrader', 'QuartzKing', 'AxolotlAce', 'CopperCat', 'SMPWhale', 'RedstoneRay', 'EnderEcho', 'TotemLord', 'BeaconBee'];
  const multiplier = type === 'money' ? 750000000 : type === 'playtime' ? 720000 : 150000;
  return { result: names.map((name, index) => ({ name, player: name, value: Math.round(multiplier * (1 - index * 0.073)) })), page, demo: true };
}

module.exports = { demoAuctions, demoTransactions, demoLeaderboard, ITEMS };
