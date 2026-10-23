import { describe,it,expect } from 'vitest'
import { SKILLS, xpThreshold,levelForXp,freshSkills,gather,craft,regenerate } from './skills'
describe('Living World skill domain',()=>{
 it('initializes 15 skills',()=>expect(Object.keys(freshSkills().xp)).toEqual([...SKILLS]))
 it('matches level 99 reference threshold',()=>expect(xpThreshold(99)).toBe(13034431))
 it('XP level boundaries',()=>{expect(levelForXp(0)).toBe(1);expect(levelForXp(xpThreshold(50))).toBe(50);expect(levelForXp(xpThreshold(99))).toBe(99)})
 it('XP threshold strictly increases',()=>{for(let n=2;n<100;n++)expect(xpThreshold(n)).toBeGreaterThan(xpThreshold(n-1))})
 it('gather does not mutate input',()=>{const s=freshSkills();const next=gather(s,'pond','east');expect(s.inventory.raw_fish).toBeUndefined();expect(next.inventory.raw_fish).toBe(1);expect(next.xp.Fishing).toBe(25)})
 it('node depletion is enforced',()=>{let s=freshSkills();for(let i=0;i<8;i++)s=gather(s,'fern','north');expect(()=>gather(s,'fern','north')).toThrow()})
 it('separate node stocks stay independent',()=>{const s=gather(freshSkills(),'fern','north');expect(gather(s,'fern','south').stock['fern:south']).toBe(7)})
 it('crafting checks materials',()=>expect(()=>craft(freshSkills(),'cooked_fish')).toThrow())
 it('crafting consumes inventory and gains xp',()=>{const s=gather(freshSkills(),'pond','east');const c=craft(s,'cooked_fish');expect(c.inventory.raw_fish).toBe(0);expect(c.inventory.cooked_fish).toBe(1);expect(c.xp.Cooking).toBe(30)})
 it('Herblore consumes two herbs and spring water',()=>{let s=freshSkills();s=gather(s,'fern','n');s=gather(s,'fern','n');s=gather(s,'spring','s');expect(craft(s,'herbal_tonic').inventory.herbal_tonic).toBe(1)})
 it('regeneration restores node stock without exceeding capacity',()=>{let s=gather(freshSkills(),'pond','east');s=regenerate(s);expect(s.stock['pond:east']).toBe(10);expect(regenerate(s).stock['pond:east']).toBe(10)})
 it('rejects unknown resource and empty node ID',()=>{expect(()=>gather(freshSkills(),'fern','')).toThrow();expect(()=>gather(freshSkills(),'bad' as never,'x')).toThrow()})
 it('rejects invalid XP',()=>{expect(()=>levelForXp(-1)).toThrow();expect(()=>xpThreshold(100)).toThrow()})
})
