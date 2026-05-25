export type MobType =
  | 'mager'
  | 'ranger'
  | 'meleer'
  | 'blob'
  | 'bat'
  | 'nibbler'
  | 'blobletMage'
  | 'blobletRange'
  | 'blobletMelee';

export type AttackStyle = 'magic' | 'range' | 'melee' | 'blob';

export type PrayerType = 'mage' | 'range' | 'melee';

export type PrayerSequence = [PrayerType, PrayerType, PrayerType, PrayerType];

export type PillarKey = 'S' | 'W' | 'N';

export type PillarConfig = Record<PillarKey, boolean>;

export type LoadoutKey = 'magetank' | 'blowpipe' | 'bloodBarrage';

export interface Tile {
  x: number;
  y: number;
}

export interface MobDef {
  letter: string;
  size: number;
  hp: number;
  atkSpeed: number;
  range: number;
  style: AttackStyle;
  color: string;
  isBlob?: boolean;
  hasFlicker?: boolean;
  hasDig?: boolean;
}

export interface IncomingMobProjectile {
  delay: number;
  damage: number;
}

export interface IncomingPlayerProjectile {
  delay: number;
  damage: number;
  mobType: MobType;
  mobId: number;
  style: AttackStyle;
  fireTick?: number;
}

export interface RecoilHit {
  tick: number;
  mobId: number;
  damage: number;
  source: 'ring' | 'echo';
}

export interface Mob {
  id: number;
  type: MobType;
  letter: string;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  atkSpeed: number;
  range: number;
  style: AttackStyle;
  color: string;
  attackDelay: number;
  stunned: number;
  frozen: number;
  dead: boolean;
  dying: number;
  dyingStartTick: number;
  corpseRemovalTick: number | undefined;
  pendingRemovalTick: number | undefined;
  revivedOnce: boolean;
  hasLOS: boolean;
  hadLOS: boolean;
  isBlob: boolean;
  blobScanPrayer: 'scanned' | null;
  hasDig: boolean;
  digTimer: number;
  digLocation: Tile | null;
  hasFlicker: boolean;
  flickering: boolean;
  incomingProjectiles: IncomingMobProjectile[];
  noLOSTicks: number;
  currentStyle: AttackStyle | null;
  infNum?: number;
  parentBlobId?: number;
  aggroTarget?: 'player';
  _lastScanTick?: number;
}

export interface Player {
  x: number;
  y: number;
  size: 1;
  hp: number;
  maxHp: number;
  aggro: Mob | null;
  attackDelay: number;
  range: number;
  atkSpeed: number;
  incomingProjectiles: IncomingPlayerProjectile[];
  autoRetaliate: boolean;
  lastHit: boolean;
  recoilQueue: RecoilHit[];
  echoBootsCooldown: number;
  lastBarrageTarget: { x: number; y: number; tick: number } | null;
  lastAttacker: Mob | null;
}

export interface Entity {
  x: number;
  y: number;
  size: number;
}

export interface Pillar extends Entity {
  hp: number;
  maxHp: number;
  isPillar: true;
  dead: boolean;
  id: string;
}

export interface Region {
  entities: (Entity | Pillar)[];
  pillars: Pillar[];
  blocked: Uint8Array;
}

export interface MonsterAttackBase {
  max: number;
  acc: number;
}

export interface MonsterAttackWithMelee extends MonsterAttackBase {
  melee?: MonsterAttackBase;
}

export interface MonsterAttackBlob {
  mage: MonsterAttackBase;
  range: MonsterAttackBase;
  melee: MonsterAttackBase;
}

export type MonsterAttackStats = MonsterAttackWithMelee | MonsterAttackBlob;

export interface Loadout {
  name: string;
  atkSpeed: number;
  maxHit: number;
  range: number;
  isBloodBarrage?: boolean;
  hasRecoil?: boolean;
  playerAcc: Record<MobType, [number, number]>;
  monsterAtk: Record<MobType, MonsterAttackStats>;
}

export interface ParsedSpawn {
  type: MobType | 'nothing';
  x: number;
  y: number;
  infNum: number;
}

export interface ParsedSpawnCode {
  spawns: ParsedSpawn[];
  hasIndexInfo: boolean;
}

export interface SpawnCodeError {
  error: string;
}

export interface DelayedBlobletSpawn {
  tick: number;
  blob: Mob;
}

export interface AttackEvent {
  tick: number;
  mobId: number;
  mobType: MobType;
  style: AttackStyle | null;
  isScan: boolean;
  scanTick: number;
  accRoll: number;
  dmgRoll: number;
  distAtFire?: number;
  hitTick?: number;
  isPlayerAttack?: boolean;
  playerDmg?: number;
  targetMobId?: number;
  targetMobType?: MobType;
  isRevive?: boolean;
  reviveHp?: number;
}

export type SimRecordMode = 'live' | 'headless';

export interface SimState {
  region: Region;
  mobs: Mob[];
  player: Player;
  tick: number;
  deadMobs: Mob[];
  delayedBlobletSpawns: DelayedBlobletSpawn[];
  idCounter: number;
  loadout: Loadout;
  recordMode: SimRecordMode;
  attacks: AttackEvent[];
  mobInitHP: Record<number, { hp: number; type: MobType }>;
  mobMap: Map<number, Mob>;
}

export type TickEventKind =
  | 'hit'
  | 'scan'
  | 'attack'
  | 'playerAttack'
  | 'resurrect'
  | 'recoil'
  | 'blobletSpawn'
  | 'blobDeath';

export interface TickLogEvent {
  tick: number;
  type: MobType | 'player-atk' | 'blob';
  detail: string;
  mobId?: number;
  isHit?: boolean;
  isScan?: boolean;
  isAttack?: boolean;
  isPlayerAttack?: boolean;
  isResurrect?: boolean;
  hitTick?: number;
}

export interface TickHit {
  mobId: number;
  mobType: MobType;
  color: string;
  letter: string;
  style: AttackStyle | null;
  isScan: boolean;
}

export interface GridMobColumn {
  id: number;
  letter: string;
  color: string;
  type: MobType;
}

export interface SimResult {
  attacks: AttackEvent[];
  completedTick: number;
  mobs: Mob[];
  status: 'complete' | 'trapped' | 'invalid' | 'timeout';
  mobInitHP: Record<number, { hp: number; type: MobType }>;
}

export interface PrayerSolution {
  sequence: PrayerSequence;
  avgDamage: number;
}

export interface DamageResult {
  damage: number;
  died: boolean;
}

export interface AutozukResult {
  avgDamage: number;
  damages: number[];
  completionTicks: number[];
  over50Pct: number;
  avgTicks: number;
  avgTime: string;
  prayer: PrayerSequence;
  invalidPct: number;
  totalSims: number;
  deathPct: number;
  markedDead: boolean;
}

export interface PreviewMob {
  x: number;
  y: number;
  size: number;
  color: string;
  letter: string;
  type: MobType;
}
