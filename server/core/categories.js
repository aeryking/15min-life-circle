/**
 * 民生设施分类体系与配置标准。
 *
 * targetMinutes（步行可达目标）与 recommended（15 分钟圈内建议数量）参考：
 *  - 《城市居住区规划设计标准》GB 50180-2018（5/10/15 分钟生活圈居住区配套设施）
 *  - 《社区生活圈规划技术指南》TD/T 1062-2021
 *  - 《完整居住社区建设标准（试行）》（住建部 2020）
 * 数值为工程化取值，可在此处统一调整。
 *
 * critical = true 的类别参与赛题要求的「1 公里服务盲区」识别（菜市场 / 药店 / 小学）。
 */

/**
 * 所有类别共用的排除规则：出入口、附属设施、非服务实体等。
 * soft = true 的规则在 POI 带有明确匹配的分类标签时不生效（以百度分类为准，避免误删
 * 「明天幼稚集团八幼」「音乐学院附属艺术幼儿园」这类名称含敏感词的正规机构）。
 */
export const GLOBAL_EXCLUDE = [
  { re: /[-－—·(（]\s*[东西南北]?\d*[号]?(门|口|出入口)\s*[)）]?$/, reason: '出入口/附属点' },
  { re: /(出入口|停车场|停车库|地下车库|警卫室|传达室|收费处|售票处|充电站|卫生间|厕所)/, reason: '出入口/附属点' },
  { re: /(有限公司|集团|批发|物流|仓库|总部|办事处|招聘|工厂)/, reason: '企业/非零售实体', soft: true },
  { re: /(已关闭|暂停营业|停业|搬迁|旧址)/, reason: '已关闭/迁址' },
];

export const CATEGORIES = [
  {
    key: 'market',
    name: '菜市场/生鲜',
    short: '菜市场',
    dimension: 'shopping',
    critical: true,
    targetMinutes: 10,
    recommended: 2,
    tagMatch: /(菜市场|农贸市场|生鲜超市|果蔬超市|生鲜店|菜店|购物;市场)/,
    tagExclude: /(花鸟|建材|家具|服装|二手|小商品|电子)/,
    keywords: ['菜市场', '农贸市场', '生鲜'],
    nameInclude: /(菜市|农贸|生鲜|果蔬|蔬菜|菜场|肉|海鲜|鲜|菜店|菜篮子|早市|集市|街市|钱大妈|盒马|朴朴|叮咚|美团买菜|生鲜传奇|百果园)/,
    exclude: [{ re: /(美食|餐厅|饭店|火锅|烧烤|小吃|面馆|快餐|酒楼|烟酒|茶叶|服装|建材|家具|五金|二手|花鸟|古玩|电子|手机)/, reason: '非生鲜业态' }],
    osm: ['node["amenity"="marketplace"]', 'nwr["shop"="greengrocer"]'],
  },
  {
    key: 'pharmacy',
    name: '药店',
    short: '药店',
    dimension: 'medical',
    critical: true,
    targetMinutes: 10,
    recommended: 2,
    tagMatch: /医疗;药店/,
    tagExclude: /(宠物|兽)/,
    keywords: ['药店', '药房'],
    nameInclude: /(药|医药|药房|药店|大药房|药品)/,
    exclude: [{ re: /(兽药|宠物|动物|农药|药业有限|医药科技|制药|药材市场|药检|研究所)/, reason: '非零售药店' }],
    osm: ['nwr["amenity"="pharmacy"]'],
  },
  {
    key: 'primary_school',
    name: '小学',
    short: '小学',
    dimension: 'education',
    critical: true,
    targetMinutes: 10,
    recommended: 1,
    tagMatch: /教育培训;小学/,
    tagExclude: /(培训机构|亲子教育|艺术培训|外语培训)/,
    keywords: ['小学'],
    nameInclude: /(小学|学校|九年一贯|完全学校|实验学校|附小|育才|学校)/,
    exclude: [
      {
        re: /(培训|辅导|托管|课堂|课程|教育科技|学堂|家教|补习|艺术|舞蹈|美术|书法|编程|英语|口才|早教|驾校|少年宫|作文|思维)/,
        reason: '校外培训机构',
        soft: true,
      },
      { re: /(教学楼|操场|体育馆|食堂|宿舍|校门|分部办公|报名处)/, reason: '校内附属点' },
    ],
    osm: ['nwr["amenity"="school"]'],
  },
  {
    key: 'kindergarten',
    name: '幼儿园',
    short: '幼儿园',
    dimension: 'education',
    critical: false,
    targetMinutes: 5,
    recommended: 1,
    tagMatch: /教育培训;幼儿园/,
    tagExclude: /(培训机构|早教)/,
    keywords: ['幼儿园'],
    nameInclude: /(幼儿园|幼稚园|托育|保育院|儿童之家)/,
    exclude: [{ re: /(早教中心|培训|英语|艺术|舞蹈|美术|体适能|乐高|感统|游泳)/, reason: '校外培训机构', soft: true }],
    osm: ['nwr["amenity"="kindergarten"]'],
  },
  {
    key: 'clinic',
    name: '社区医疗',
    short: '医疗',
    dimension: 'medical',
    critical: false,
    targetMinutes: 15,
    recommended: 1,
    tagMatch: /(社区卫生服务中心|卫生院|医疗;综合医院|综合医院|中医院|医疗;诊所|私人诊所|综合诊所|中医诊所)/,
    tagExclude: /(口腔|眼科|视光|美容|整形|宠物|体检|专科医院|月子|政府机构)/,
    keywords: ['社区卫生服务中心', '社区卫生服务站', '医院', '诊所'],
    nameInclude: /(卫生服务|卫生站|卫生院|医院|诊所|门诊|医务室|中医|社区医疗|急救)/,
    exclude: [
      { re: /(宠物|动物|兽医|美容|整形|医美|口腔|牙科|齿科|眼镜|视光|体检中心|按摩|足疗|养生|推拿|月子|男科|妇科|不孕|植发)/, reason: '非基础医疗' },
      { re: /(住院部|急诊楼|门诊楼|病房|挂号|药剂科|放射科|检验科|行政楼)/, reason: '院内附属点' },
    ],
    osm: ['nwr["amenity"~"^(clinic|doctors|hospital)$"]'],
  },
  {
    key: 'elderly',
    name: '养老服务',
    short: '养老',
    dimension: 'elderly',
    critical: false,
    targetMinutes: 15,
    recommended: 1,
    tagMatch: /(养老服务|养老院|敬老院|老年活动|老年大学|日间照料)/,
    tagExclude: /(殡葬|墓)/,
    keywords: ['养老驿站', '养老院', '老年活动中心', '日间照料中心'],
    nameInclude: /(养老|老年|敬老|颐养|照料|长者|托老|老人|银发|幸福晚年|助老|康养)/,
    exclude: [{ re: /(老年大学招生|保健品|老年用品店|殡葬|墓园)/, reason: '非养老服务' }],
    osm: ['nwr["amenity"="social_facility"]["social_facility:for"~"senior"]', 'nwr["amenity"="nursing_home"]'],
  },
  {
    key: 'supermarket',
    name: '超市便利店',
    short: '超市',
    dimension: 'shopping',
    critical: false,
    targetMinutes: 5,
    recommended: 3,
    tagMatch: /购物;(超市|便利店)/,
    tagExclude: /(自动售货|烟酒)/,
    keywords: ['超市', '便利店'],
    nameInclude: /(超市|便利|商店|商行|百货|购物|mart|711|7-eleven|全家|罗森|美宜佳|物美|华联|盒马)/i,
    exclude: [{ re: /(烟酒|酒行|茶行|母婴|服装|手机|电器|建材|家居|五金|花店|宠物|眼镜|珠宝|自动售货)/, reason: '非综合零售' }],
    osm: ['nwr["shop"~"^(supermarket|convenience)$"]'],
  },
  {
    key: 'transit',
    name: '公共交通',
    short: '公交',
    dimension: 'transit',
    critical: false,
    targetMinutes: 5,
    recommended: 3,
    tagMatch: /交通设施;(公交车站|地铁站|轻轨站|火车站|长途汽车站)/,
    tagExclude: /(停车场|出入口|加油|充电|收费站)/,
    keywords: ['公交站', '地铁站'],
    nameInclude: /(站|公交|地铁|枢纽|场站)/,
    exclude: [{ re: /(加油站|充电站|收费站|服务站|派出所|检查站|停车)/, reason: '非公共交通站点' }],
    osm: ['node["highway"="bus_stop"]', 'node["railway"="station"]'],
  },
  {
    key: 'park',
    name: '公园体育',
    short: '公园',
    dimension: 'leisure',
    critical: false,
    targetMinutes: 10,
    recommended: 1,
    tagMatch: /(旅游景点;公园|城市公园|森林公园|休闲娱乐;休闲广场|运动健身;体育场馆|运动健身;体育场|运动场)/,
    tagExclude: /(健身房|健身中心|私教|台球|攀岩|拳击|搏击|瑜伽|游泳馆|极限运动|棋牌)/,
    keywords: ['公园', '体育场馆', '健身广场'],
    nameInclude: /(公园|绿地|游园|广场|体育|健身|运动场|球场|步道|绿道)/,
    exclude: [
      { re: /(购物广场|商业广场|写字楼|大厦|酒店|餐厅|科技园|产业园|工业园|软件园|创业园|孵化|售楼|停车)/, reason: '非公共休闲空间' },
      { re: /(健身房|私教|瑜伽|普拉提|跆拳道|拳击|游泳馆会员)/, reason: '商业健身会所' },
    ],
    osm: ['nwr["leisure"~"^(park|pitch|sports_centre|fitness_station)$"]'],
  },
];

/** 居住区：不参与评分，作为盲区影响评估与规划选址的需求点（人口代理） */
export const RESIDENTIAL = {
  key: 'residential',
  name: '居住小区',
  keywords: ['小区', '住宅区'],
  tagMatch: /房地产;住宅区/,
  tagExclude: /(写字楼|商务楼|产业园|商铺|售楼)/,
  nameInclude: /(小区|花园|家园|公寓|苑|园|里|庭|府|城|村|社区|宿舍|新村|大院|佳园|嘉园|华庭)/,
  exclude: [
    {
      re: /(号楼|单元|栋|座|期|区\d|地下|车库|门$|售楼|营销中心|物业|写字楼|大厦|中心$|广场|科技园|产业园|软件园|工业园|商务|酒店)/,
      reason: '楼栋/非住宅实体',
    },
  ],
};

export const DIMENSIONS = [
  { key: 'medical', name: '医疗健康' },
  { key: 'education', name: '基础教育' },
  { key: 'shopping', name: '生鲜购物' },
  { key: 'elderly', name: '养老服务' },
  { key: 'transit', name: '公共交通' },
  { key: 'leisure', name: '休闲健身' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const CRITICAL_KEYS = CATEGORIES.filter((c) => c.critical).map((c) => c.key);

/** 步行速度人群画像（米/秒） */
export const SPEED_PROFILES = [
  { key: 'adult', name: '成年人', speed: 1.2, note: '常规步速 72 m/min' },
  { key: 'elderly', name: '老年人', speed: 0.9, note: '适老步速 54 m/min' },
  { key: 'child', name: '亲子/儿童', speed: 1.0, note: '陪同儿童 60 m/min' },
];

/**
 * 各人群视角的维度权重（相对值，评分时按总和归一化）。
 * 成年人六维等权；老年人侧重医疗、养老与休闲（就医买药、日间照料、散步健身），弱化基础教育；
 * 亲子侧重基础教育、休闲与医疗（上学接送、户外活动、儿童就医）。亲子视角不弱化养老：隔代照料普遍，
 * 接送孩子的常是老人；且养老通常是最弱的一维，弱化它会让亲子分「虚高」，掩盖教育短板。
 * 依据《社区生活圈规划技术指南》TD/T 1062-2021 对「一老一小」服务要素的关注，数值为工程化取值。
 */
export const PROFILE_WEIGHTS = {
  adult: { medical: 1, education: 1, shopping: 1, elderly: 1, transit: 1, leisure: 1 },
  elderly: { medical: 1.5, education: 0.5, shopping: 1, elderly: 1.5, transit: 1, leisure: 1.25 },
  child: { medical: 1.25, education: 2, shopping: 1, elderly: 1, transit: 1, leisure: 1.5 },
};

/** 盲区判定阈值：周边 1 公里步行距离（赛题口径） */
export const BLIND_THRESHOLD_METERS = 1000;
