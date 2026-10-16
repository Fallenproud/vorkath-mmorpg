/**
 * Side-effect-free Living World skill domain.
 * IMPORTANT: This does not mutate the existing Life-Core EcoGrid or save.v2.
 * The host game owns interaction, resource placement, save migrations and authority.
 */
export const SKILLS = ['Attack','Strength','Defence','Ranged','Magic','Vitality','Fishing','Hunting','Cooking','Herblore','Foraging','Mining','Smithing','Botany','Crystalcraft'] as const
export type Skill = (typeof SKILLS)[number]
export interface SkillState { xp: Record<Skill, number>; inventory: Record<string, number>; stock: Record<string, number> }
export const GATHER = {
  fern: { skill:'Foraging', item:'fern_leaf', xp:15, capacity:8 },
  pond: { skill:'Fishing', item:'raw_fish', xp:25, capacity:10 },
  grazer: { skill:'Hunting', item:'raw_meat', xp:35, capacity:6 },
  spring: { skill:'Foraging', item:'spring_water', xp:3, capacity:12 },
} as const satisfies Record<string,{skill:Skill;item:string;xp:number;capacity:number}>
export type Resource = keyof typeof GATHER
export const RECIPES = {
  cooked_fish: { skill:'Cooking', level:1, xp:30, ingredients:{raw_fish:1} },
  herbal_tonic: { skill:'Herblore', level:1, xp:40, ingredients:{fern_leaf:2,spring_water:1} },
  grazer_stew: { skill:'Cooking', level:5, xp:80, ingredients:{raw_meat:1,fern_leaf:1} },
} as const satisfies Record<string,{skill:Skill;level:number;xp:number;ingredients:Record<string,number>}>
export type Recipe = keyof typeof RECIPES
export const xpThreshold=(level:number):number=>{
  if(!Number.isInteger(level)||level<1||level>99)throw new Error('Invalid level')
  let points=0
  for(let n=1;n<level;n++) points+=Math.floor(n+300*Math.pow(2,n/7))
  return Math.floor(points/4)
}
export function levelForXp(xp:number):number {
  if(!Number.isSafeInteger(xp)||xp<0)throw new Error('Invalid XP')
  let lo=1,hi=99
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(xpThreshold(mid)<=xp)lo=mid;else hi=mid-1}
  return lo
}
export function freshSkills():SkillState {
  return { xp:Object.fromEntries(SKILLS.map(s=>[s,0])) as Record<Skill,number>, inventory:{},stock:{} }
}
export function gather(state:SkillState,resource:Resource,nodeId:string):SkillState {
  if(!Object.hasOwn(GATHER,resource)||!nodeId.trim())throw new Error('Unknown node')
  const cfg=GATHER[resource]
  const key=resource+':'+nodeId
  const remaining=state.stock[key]??cfg.capacity
  if(!Number.isInteger(remaining)||remaining<=0||remaining>cfg.capacity)throw new Error('Node depleted or invalid')
  const out=structuredClone(state)
  out.stock[key]=remaining-1
  out.inventory[cfg.item]=(out.inventory[cfg.item]??0)+1
  out.xp[cfg.skill]+=cfg.xp
  return out
}
export function craft(state:SkillState,recipe:Recipe):SkillState {
  if(!Object.hasOwn(RECIPES,recipe))throw new Error('Unknown recipe')
  const cfg=RECIPES[recipe]
  if(levelForXp(state.xp[cfg.skill])<cfg.level)throw new Error('Skill level too low')
  if(Object.entries(cfg.ingredients).some(([id,n])=>(state.inventory[id]??0)<n))throw new Error('Missing ingredients')
  const out=structuredClone(state)
  for(const [id,n] of Object.entries(cfg.ingredients))out.inventory[id]-=n
  out.inventory[recipe]=(out.inventory[recipe]??0)+1
  out.xp[cfg.skill]+=cfg.xp
  return out
}
export function regenerate(state:SkillState):SkillState {
  const out=structuredClone(state)
  for(const [key,value] of Object.entries(out.stock)) {
    const kind=key.split(':',1)[0] as Resource
    if(!Object.hasOwn(GATHER,kind))continue
    out.stock[key]=Math.min(GATHER[kind].capacity,value+1)
  }
  return out
}
