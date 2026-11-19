export function normalizeLabelName(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const ALIASES: Record<string, string> = {
  hippo: 'hippopotamus',
  rhino: 'rhinoceros',
  bufallo: 'buffalo',
  cattle: 'cow',
  cows: 'cow',
  roan: 'roanantelope',
  sableantelope: 'sable',
  hyena: 'spottedhyena',
  hyenaspotted: 'spottedhyena',
  maraboustork: 'marabou',
  dogdomestic: 'domesticdog',
  dog: 'domesticdog',
  servalcat: 'serval',
  blackcrowncrane: 'blackcrownedcrane',
  crownedcrane: 'blackcrownedcrane',
  greaterkudu: 'kudu',
  gemsbok: 'oryx',
  bluewildebeest: 'wildebeest',
  blackbackedjackal: 'jackal',
  person: 'human',
  people: 'human',
  shoats: 'shoat',
  unkown: 'unknown',
  springbuck: 'springbok',
  steenbuck: 'steenbok',
  vlakvark: 'warthog',
};

export function canonicalLabelName(name: string): string {
  const key = normalizeLabelName(name);
  return ALIASES[key] ?? key;
}

const COMMON_LABELS = [
  'unknown',
  'elephant',
  'eland',
  'warthog',
  'giraffe',
  'crocodile',
  'human',
  'vehicle',
  'lion',
  'bird',
  'baboon',
  'ostrich',
  'reedbuck',
  'cow',
  'cheetah',
  'waterbuck',
  'zebra',
  'bushbuck',
  'goat',
  'kob',
  'sheep',
  'donkey',
  'roanantelope',
  'oribi',
  'vulture',
  'lesserkudu',
  'hippopotamus',
  'tiang',
  'mongallagazelle',
  'marabou',
  'patasmonkey',
  'spottedhyena',
  'monitorlizard',
  'buffalo',
  'caracal',
  'jackal',
  'impala',
  'kudu',
  'shoebill',
  'oryx',
  'blackcrownedcrane',
  'pelican',
  'lechwe',
  'sable',
  'antelope',
  'guineafowl',
  'domesticdog',
  'serval',
  'wildebeest',
  'duiker',
  'nyala',
  'rhinoceros',
  'hartebeest',
  'shoat',
  'bushpig',
  'leopard',
  'springbok',
  'klipspringer',
  'topi',
  'steenbok',
];

const RANK = new Map(COMMON_LABELS.map((name, i) => [name, i]));

export function labelRank(name: string): number | undefined {
  return RANK.get(canonicalLabelName(name));
}

export function isCommonLabel(name: string): boolean {
  return labelRank(name) !== undefined;
}

export function compareByCommonness(a: string, b: string): number {
  const ra = labelRank(a) ?? Infinity;
  const rb = labelRank(b) ?? Infinity;
  if (ra !== rb) return ra - rb;
  const na = normalizeLabelName(a);
  const nb = normalizeLabelName(b);
  return na.length - nb.length || na.localeCompare(nb);
}

export type LookAlikeGroup =
  | 'carcass'
  | 'nest'
  | 'structure'
  | 'smallAntelope'
  | 'largeAntelope'
  | 'livestock'
  | 'equid'
  | 'suid'
  | 'carnivore'
  | 'primate'
  | 'human'
  | 'megaherbivore'
  | 'reptile'
  | 'bird'
  | 'unknown';

// Checked in order: qualifiers like carcass/nest win over the species name.
const GROUP_PATTERNS: [LookAlikeGroup, string[]][] = [
  ['carcass', ['carcass', 'caracass', 'bone']],
  ['nest', ['nest']],
  [
    'structure',
    [
      'roof',
      'hut',
      'charcoal',
      'enclosure',
      'boma',
      'structure',
      'infrastructure',
      'settlement',
      'camp',
      'fish',
      'net',
      'clearing',
      'burnt',
      'cultivated',
      'mining',
      'vehicle',
      'truck',
      'motorbike',
      'boat',
      'canoe',
      'track',
      'waterpoint',
      'baobab',
    ],
  ],
  [
    'smallAntelope',
    [
      'oribi',
      'steenbok',
      'steenbuck',
      'duiker',
      'klipspringer',
      'dikdik',
      'grysbok',
      'suni',
      'springbok',
      'springbuck',
      'impala',
      'gazelle',
      'kob',
      'puku',
      'lechwe',
      'reedbuck',
      'bushbuck',
      'blesbok',
      'blesbuck',
    ],
  ],
  [
    'largeAntelope',
    [
      'eland',
      'kudu',
      'roan',
      'sable',
      'oryx',
      'gemsbok',
      'waterbuck',
      'tiang',
      'topi',
      'tsessebe',
      'hartebeest',
      'wildebeest',
      'nyala',
      'antelope',
    ],
  ],
  [
    'livestock',
    [
      'buffalo',
      'bufallo',
      'cow',
      'cattle',
      'goat',
      'sheep',
      'shoat',
      'livestock',
      'bison',
    ],
  ],
  ['equid', ['zebra', 'donkey', 'horse', 'mule']],
  ['suid', ['warthog', 'bushpig', 'pig', 'vlakvark', 'hog']],
  [
    'carnivore',
    [
      'lion',
      'leopard',
      'cheetah',
      'caracal',
      'serval',
      'hyena',
      'jackal',
      'wilddog',
      'dog',
      'fox',
      'badger',
      'carnivore',
      'predator',
      'wildcat',
    ],
  ],
  ['primate', ['baboon', 'babboon', 'monkey', 'primate', 'chimp', 'gorilla']],
  ['human', ['human', 'person', 'people', 'poach']],
  ['megaherbivore', ['elephant', 'rhino', 'hippo', 'giraffe']],
  [
    'reptile',
    ['crocodile', 'lizard', 'monitor', 'snake', 'tortoise', 'turtle'],
  ],
  [
    'bird',
    [
      'bird',
      'ostrich',
      'vulture',
      'marabou',
      'stork',
      'crane',
      'pelican',
      'shoebill',
      'fowl',
      'bustard',
      'hornbill',
      'saddlebill',
      'eagle',
      'heron',
      'egret',
      'ibis',
      'goose',
      'duck',
      'flamingo',
    ],
  ],
  ['unknown', ['unknown', 'unidentified', 'undetermined', 'other']],
];

export function lookAlikeGroup(name: string): LookAlikeGroup | undefined {
  const key = normalizeLabelName(name);
  if (!key) return undefined;
  for (const [group, patterns] of GROUP_PATTERNS) {
    if (patterns.some((p) => key.includes(p))) return group;
  }
  return undefined;
}

const FAMILY: Partial<Record<LookAlikeGroup, string>> = {
  smallAntelope: 'antelope',
  largeAntelope: 'antelope',
};

// 2 for the same look-alike group, 1 for related groups, 0 otherwise.
export function lookAlikeness(a: string, b: string): 0 | 1 | 2 {
  const ga = lookAlikeGroup(a);
  const gb = lookAlikeGroup(b);
  if (!ga || !gb) return 0;
  if (ga === gb) return 2;
  return FAMILY[ga] && FAMILY[ga] === FAMILY[gb] ? 1 : 0;
}
