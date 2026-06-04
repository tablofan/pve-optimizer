// Cavalry / unit data for Travian T4.6 (x3). Generated from Ash-Warden troops_t46.json,
// with Huns Marksman speed corrected 15->16 (verified x3 vs Kirilloid t4.fs/units.ts, 2026-06-02).
// speed = BASE fields/hour at 1x; on a speed server multiply by 2 (NOT by server factor).
// type: 'i' infantry, 'c' cavalry. slot maps to in-game t1..tN.
// cap = carry capacity per unit. Farm-send candidates are 'c' with cap > 0 — a carry-0
// cavalry unit is a scout (Spotter/Pathfinder/Equites Legati/…) and can never loot.

const TRIBES = [
  { id: 'romans', name: 'Romans' },
  { id: 'teutons', name: 'Teutons' },
  { id: 'gauls', name: 'Gauls' },
  { id: 'egyptians', name: 'Egyptians' },
  { id: 'huns', name: 'Huns' },
  { id: 'spartans', name: 'Spartans' },
  { id: 'vikings', name: 'Vikings' },
];

// UNITS[tribe][i] is the unit in rally-point slot t{i+1}.
const UNITS = {
  romans: [
    { slot: 't1', name: 'Legionnaire', type: 'i', speed: 6, cap: 50 },
    { slot: 't2', name: 'Praetorian', type: 'i', speed: 5, cap: 20 },
    { slot: 't3', name: 'Imperian', type: 'i', speed: 7, cap: 50 },
    { slot: 't4', name: 'Equites Legati', type: 'c', speed: 16, cap: 0 },
    { slot: 't5', name: 'Equites Imperatoris', type: 'c', speed: 14, cap: 100 },
    { slot: 't6', name: 'Equites Caesaris', type: 'c', speed: 10, cap: 70 },
    { slot: 't7', name: 'Battering ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Fire Catapult', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Senator', type: 'i', speed: 4, cap: 0 },
  ],
  teutons: [
    { slot: 't1', name: 'Maceman', type: 'i', speed: 7, cap: 60 },
    { slot: 't2', name: 'Spearman', type: 'i', speed: 7, cap: 40 },
    { slot: 't3', name: 'Axeman', type: 'i', speed: 6, cap: 50 },
    { slot: 't4', name: 'Scout', type: 'c', speed: 9, cap: 0 },
    { slot: 't5', name: 'Paladin', type: 'c', speed: 10, cap: 110 },
    { slot: 't6', name: 'Teutonic Knight', type: 'c', speed: 9, cap: 80 },
    { slot: 't7', name: 'Ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Catapult', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Chief', type: 'i', speed: 4, cap: 0 },
  ],
  gauls: [
    { slot: 't1', name: 'Phalanx', type: 'i', speed: 7, cap: 35 },
    { slot: 't2', name: 'Swordsman', type: 'i', speed: 6, cap: 45 },
    { slot: 't3', name: 'Pathfinder', type: 'c', speed: 17, cap: 0 },
    { slot: 't4', name: 'Theutates Thunder', type: 'c', speed: 19, cap: 75 },
    { slot: 't5', name: 'Druidrider', type: 'c', speed: 16, cap: 35 },
    { slot: 't6', name: 'Haeduan', type: 'c', speed: 13, cap: 65 },
    { slot: 't7', name: 'Ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Trebuchet', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Chieftain', type: 'i', speed: 5, cap: 0 },
  ],
  egyptians: [
    { slot: 't1', name: 'Slave Militia', type: 'i', speed: 7, cap: 15 },
    { slot: 't2', name: 'Ash Warden', type: 'i', speed: 6, cap: 50 },
    { slot: 't3', name: 'Khopesh Warrior', type: 'i', speed: 7, cap: 45 },
    { slot: 't4', name: 'Sopdu Explorer', type: 'c', speed: 16, cap: 0 },
    { slot: 't5', name: 'Anhur Guard', type: 'c', speed: 15, cap: 50 },
    { slot: 't6', name: 'Resheph Chariot', type: 'c', speed: 10, cap: 70 },
    { slot: 't7', name: 'Ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Stone Catapult', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Nomarch', type: 'i', speed: 4, cap: 0 },
    { slot: 't10', name: 'Settler', type: 'i', speed: 5, cap: 3000 },
  ],
  huns: [
    { slot: 't1', name: 'Mercenary', type: 'i', speed: 6, cap: 50 },
    { slot: 't2', name: 'Bowman', type: 'i', speed: 6, cap: 30 },
    { slot: 't3', name: 'Spotter', type: 'c', speed: 19, cap: 0 },
    { slot: 't4', name: 'Steppe Rider', type: 'c', speed: 16, cap: 75 },
    { slot: 't5', name: 'Marksman', type: 'c', speed: 16, cap: 105 },
    { slot: 't6', name: 'Marauder', type: 'c', speed: 14, cap: 80 },
    { slot: 't7', name: 'Ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Catapult', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Logades', type: 'i', speed: 5, cap: 0 },
    { slot: 't10', name: 'Settler', type: 'i', speed: 5, cap: 3000 },
  ],
  spartans: [
    { slot: 't1', name: 'Hoplite', type: 'i', speed: 6, cap: 60 },
    { slot: 't2', name: 'Sentinel', type: 'i', speed: 9, cap: 0 },
    { slot: 't3', name: 'Shieldsman', type: 'i', speed: 8, cap: 40 },
    { slot: 't4', name: 'Twinsteel Therion', type: 'i', speed: 6, cap: 50 },
    { slot: 't5', name: 'Elpida Rider', type: 'c', speed: 16, cap: 110 },
    { slot: 't6', name: 'Corinthian Crusher', type: 'c', speed: 9, cap: 80 },
    { slot: 't7', name: 'Ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Ballista', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Ephor', type: 'i', speed: 4, cap: 0 },
    { slot: 't10', name: 'Settler', type: 'i', speed: 5, cap: 3000 },
  ],
  vikings: [
    { slot: 't1', name: 'Thrall', type: 'i', speed: 7, cap: 55 },
    { slot: 't2', name: 'Shield Maiden', type: 'i', speed: 7, cap: 40 },
    { slot: 't3', name: 'Berserker', type: 'i', speed: 5, cap: 75 },
    { slot: 't4', name: 'Heimdall’s Eye', type: 'i', speed: 9, cap: 0 },
    { slot: 't5', name: 'Huskarl Rider', type: 'c', speed: 12, cap: 110 },
    { slot: 't6', name: 'Valkyrie’s Blessing', type: 'c', speed: 9, cap: 80 },
    { slot: 't7', name: 'Ram', type: 'i', speed: 4, cap: 0 },
    { slot: 't8', name: 'Catapult', type: 'i', speed: 3, cap: 0 },
    { slot: 't9', name: 'Jarl', type: 'i', speed: 5, cap: 0 },
    { slot: 't10', name: 'Settler', type: 'i', speed: 5, cap: 3000 },
  ],
};

if (typeof module !== 'undefined' && module.exports) module.exports = { TRIBES, UNITS };
