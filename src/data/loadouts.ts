import type { Loadout, LoadoutKey } from '../types';

export const PLAYER_ATK_SPEED = 5;
export const PLAYER_RANGE = 6;
export const PLAYER_DAMAGE = 10;

export const LOADOUTS: Record<LoadoutKey, Loadout> = {
  magetank: {
    name: 'Mage Tank',
    atkSpeed: 3,
    maxHit: 39,
    range: 8,
    // [afterHit, afterMiss] — Confliction Gauntlets
    playerAcc: {
      nibbler: [0.9772, 0.9993],
      bat: [0.8779, 0.9801],
      blob: [0.6764, 0.8604],
      blobletMelee: [0.9862, 0.9997],
      blobletMage: [0.753, 0.9187],
      blobletRange: [0.9862, 0.9997],
      meleer: [0.7391, 0.9093],
      ranger: [0.8637, 0.9752],
      mager: [0.5746, 0.7587],
    },
    monsterAtk: {
      nibbler: { max: 4, acc: 1.0 },
      bat: { max: 19, acc: 0.0894 },
      blob: {
        mage: { max: 29, acc: 0.6592 },
        range: { max: 29, acc: 0.1359 },
        melee: { max: 29, acc: 0.0751 },
      },
      blobletMelee: { max: 18, acc: 0.0602 },
      blobletMage: { max: 18, acc: 0.4572 },
      blobletRange: { max: 18, acc: 0.0847 },
      meleer: { max: 49, acc: 0.098 },
      ranger: { max: 46, acc: 0.1987, melee: { max: 19, acc: 0.0662 } },
      mager: { max: 70, acc: 0.8589, melee: { max: 52, acc: 0.1734 } },
    },
  },
  blowpipe: {
    name: 'Max Blowpipe',
    atkSpeed: 2,
    maxHit: 32,
    range: 5,
    // [acc, acc] — single accuracy (no Confliction Gauntlets)
    playerAcc: {
      nibbler: [0.9852, 0.9852],
      bat: [0.9025, 0.9025],
      blob: [0.8706, 0.8706],
      blobletMelee: [0.907, 0.907],
      blobletMage: [0.907, 0.907],
      blobletRange: [0.8706, 0.8706],
      meleer: [0.7945, 0.7945],
      ranger: [0.9383, 0.9383],
      mager: [0.7594, 0.7594],
    },
    monsterAtk: {
      nibbler: { max: 4, acc: 1.0 },
      bat: { max: 19, acc: 0.2462 },
      blob: {
        mage: { max: 29, acc: 0.3796 },
        range: { max: 29, acc: 0.374 },
        melee: { max: 29, acc: 0.1614 },
      },
      blobletMelee: { max: 18, acc: 0.1486 },
      blobletMage: { max: 18, acc: 0.2366 },
      blobletRange: { max: 18, acc: 0.2331 },
      meleer: { max: 49, acc: 0.283 },
      ranger: { max: 46, acc: 0.5428, melee: { max: 19, acc: 0.1423 } },
      mager: { max: 70, acc: 0.7273, melee: { max: 52, acc: 0.3936 } },
    },
  },
  bloodBarrage: {
    name: 'Blood Barrage',
    atkSpeed: 5,
    maxHit: 40,
    range: 10,
    isBloodBarrage: true,
    hasRecoil: true,
    // [afterHit, afterMiss] — Confliction Gauntlets
    playerAcc: {
      nibbler: [0.9716, 0.9989],
      bat: [0.8476, 0.969],
      blob: [0.5962, 0.7826],
      blobletMelee: [0.9828, 0.9996],
      blobletMage: [0.6917, 0.8733],
      blobletRange: [0.9828, 0.9996],
      meleer: [0.6744, 0.8587],
      ranger: [0.8299, 0.9614],
      mager: [0.4709, 0.6278],
    },
    monsterAtk: {
      nibbler: { max: 4, acc: 1.0 },
      bat: { max: 19, acc: 0.0838 },
      blob: {
        mage: { max: 29, acc: 0.5946 },
        range: { max: 29, acc: 0.1273 },
        melee: { max: 29, acc: 0.0754 },
      },
      blobletMelee: { max: 18, acc: 0.0576 },
      blobletMage: { max: 18, acc: 0.3843 },
      blobletRange: { max: 18, acc: 0.0793 },
      meleer: { max: 49, acc: 0.094 },
      ranger: { max: 46, acc: 0.1862, melee: { max: 19, acc: 0.0665 } },
      mager: { max: 70, acc: 0.8322, melee: { max: 52, acc: 0.1737 } },
    },
  },
};
