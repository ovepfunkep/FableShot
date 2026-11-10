package app.fableshot.android.domain
import org.junit.Test
import org.junit.Assert.*
class TargetCatalogTest {
 @Test fun everyBoundaryUsesHigherZoneAndOutsideUsesLowerZone(){
  for(p in TargetCatalog.all)for((i,z)in p.zones.withIndex()){
   assertEquals("${p.id} ${z.code}",z.code,p.score(TargetPoint(z.outerRadius,0.0)).code)
   assertEquals(z.code,p.score(TargetPoint(0.0,-z.outerRadius)).code)
   assertEquals(p.zones.getOrNull(i+1)?.code?:"M",p.score(TargetPoint(z.outerRadius+1e-7,0.0)).code)
  }
 }
 @Test fun indoorInnerTenIsNotOuterTenOrX(){
  assertEquals(10,TargetCatalog.indoor.score(TargetPoint(.075,0.0)).points)
  assertEquals(9,TargetCatalog.compound.score(TargetPoint(.075,0.0)).points)
  assertEquals("10",TargetCatalog.compound.score(TargetPoint(.05,0.0)).code)
  assertFalse(TargetCatalog.compound.supportsX)
 }
 @Test fun xIsTenAndDoesNotChangeTotal(){assertEquals(TargetZone("X",10,.05),TargetCatalog.outdoor.score(TargetPoint(0.0,0.0)));assertEquals("10",TargetCatalog.outdoor.score(TargetPoint(.08,0.0)).code)}
 @Test fun reducedFaceKeepsNominalRadiusAndMissingRingsAreMisses(){assertEquals(5,TargetCatalog.reduced.score(TargetPoint(.6,0.0)).points);assertEquals(0,TargetCatalog.reduced.score(TargetPoint(.61,0.0)).points);assertFalse(4 in TargetCatalog.reduced.values)}
 @Test fun diametersAreExplicitAndCustomIsEducationalOnly(){assertTrue(TargetCatalog.practice.acceptsDiameter(550));assertFalse(TargetCatalog.outdoor.acceptsDiameter(550));assertFalse(TargetCatalog.indoor.acceptsDiameter(800));assertTrue(TargetCatalog.compound.acceptsDiameter(400));assertFalse(TargetCatalog.practice.acceptsDiameter(0))}
}
