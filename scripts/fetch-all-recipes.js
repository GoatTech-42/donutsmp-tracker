const https = require('https');
const fs = require('fs');

const BASE_URL = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.20';

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[Fetch] Getting items...');
  const items = await fetchJSON(`${BASE_URL}/items.json`);
  const itemMap = new Map();
  const itemIdToName = new Map();
  for (const item of items) {
    itemMap.set(item.id, item);
    itemIdToName.set(item.id, item.displayName || item.name);
  }
  console.log(`[Fetch] Loaded ${items.length} items`);

  console.log('[Fetch] Getting recipes...');
  const recipes = await fetchJSON(`${BASE_URL}/recipes.json`);
  console.log(`[Fetch] Loaded recipes for ${Object.keys(recipes).length} result items`);

  const recipeList = [];
  let parsedCount = 0;
  let skippedCount = 0;
  
  for (const [resultIdStr, recipeArray] of Object.entries(recipes)) {
    const resultId = parseInt(resultIdStr);
    const resultItem = itemIdToName.get(resultId) || `ID:${resultId}`;
    
    for (const recipe of recipeArray) {
      let ingredients = [];
      let resultCount = recipe.result?.count || 1;
      
      // Parse ingredients based on recipe type
      if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
        // Shapeless recipe
        for (const ing of recipe.ingredients) {
          const ingId = typeof ing === 'number' ? ing : (ing.id || 0);
          const ingCount = typeof ing === 'object' ? (ing.count || 1) : 1;
          const ingName = itemIdToName.get(ingId) || `ID:${ingId}`;
          ingredients.push({ item: ingName, count: ingCount });
        }
      } else if (recipe.inShape && Array.isArray(recipe.inShape)) {
        // Shaped recipe
        const counts = new Map();
        for (const row of recipe.inShape) {
          for (const cell of row) {
            if (cell === null || cell === undefined) continue;
            const ingId = typeof cell === 'number' ? cell : (cell[0] || cell.id || 0);
            const ingMeta = typeof cell === 'object' && cell[1] !== undefined ? cell[1] : (cell.metadata || -1);
            const metaKey = ingMeta >= 0 ? ingMeta : -1;
            const mapKey = `${ingId}:${metaKey}`;
            counts.set(mapKey, (counts.get(mapKey) || 0) + 1);
          }
        }
        for (const [key, count] of counts) {
          const [ingId] = key.split(':').map(Number);
          const ingName = itemIdToName.get(ingId) || `ID:${ingId}`;
          ingredients.push({ item: ingName, count });
        }
      } else if (recipe.result) {
        // Furnace, blast furnace, smoker, campfire, smithing, stonecutter, brewing
        const ing = recipe.input || recipe.base || recipe.addition || recipe.ingredient;
        if (ing) {
          if (Array.isArray(ing)) {
            for (const i of ing) {
              const ingId = typeof i === 'number' ? i : (i.id || i.item || 0);
              const ingCount = typeof i === 'object' ? (i.count || 1) : 1;
              const ingName = itemIdToName.get(ingId) || `ID:${ingId}`;
              ingredients.push({ item: ingName, count: ingCount });
            }
          } else {
            const ingId = typeof ing === 'number' ? ing : (ing.id || ing.item || 0);
            const ingCount = typeof ing === 'object' ? (ing.count || 1) : 1;
            const ingName = itemIdToName.get(ingId) || `ID:${ingId}`;
            ingredients.push({ item: ingName, count: ingCount });
          }
        }
      }
      
      if (ingredients.length > 0) {
        let category = 'crafting';
        if (recipe.ingredients) category = 'shapeless';
        else if (recipe.inShape) category = 'shaped';
        else if (recipe.input || recipe.base) category = 'smelting';
        else category = 'special';
        
        recipeList.push({
          result: itemIdToName.get(parseInt(resultIdStr)) || `ID:${resultIdStr}`,
          resultCount: recipe.result?.count || 1,
          ingredients,
          category,
          recipeType: recipe.ingredients ? 'shapeless' : (recipe.inShape ? 'shaped' : (recipe.input || recipe.base ? 'smelting' : 'special'))
        });
        parsedCount++;
      } else {
        skippedCount++;
      }
    }
  }
  
  console.log(`[Parse] Successfully parsed: ${parsedCount} recipes`);
  console.log(`[Parse] Skipped (no ingredients): ${skippedCount}`);
  
  const output = `// Auto-generated from PrismarineJS/minecraft-data 1.20\n// ${recipeList.length} total recipes\nconst RECIPES = ${JSON.stringify(recipeList, null, 2)};\n\nmodule.exports = RECIPES;`;
  fs.writeFileSync('lib/recipes.js', output);
  console.log(`[Done] Wrote ${recipeList.length} recipes to lib/recipes.js`);
}

main().catch(e => { console.error(e); process.exit(1); });