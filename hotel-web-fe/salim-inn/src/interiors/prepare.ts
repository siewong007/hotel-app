// The interior's materials and generated textures, listed so the lazy build
// (World.buildInterior) can make them one at a time between frames: making
// them is most of the interior's cost, and the parts' constructors, which
// reach for them, then find them cached. Every room type's variants are
// here too, so a configurator switch only builds geometry.
import { PublicMats, clockFace, featureStone, glowTexture, scallopWash, sconceWash, stripWash } from './lobbyMaterials';
import { RoomMats, chevronTextures, damaskTextures, laminateTextures, weaveNormal, woodLaminate, wrinkleNormal, type HeadStyle } from './roomMaterials';

const HEADS: HeadStyle[] = ['tufted', 'goldPiping', 'whiteStripes', 'thinStripes', 'channel'];

export function interiorMaterials(): (() => unknown)[] {
  return [
    // lobby, counter, stair and corridor
    PublicMats.porcelain, PublicMats.terrazzo, PublicMats.carpet, PublicMats.walnutFluted, PublicMats.walnut,
    PublicMats.door, PublicMats.frame, PublicMats.marble, PublicMats.stone, PublicMats.brass, PublicMats.brushed,
    PublicMats.plaster, PublicMats.corridorWall, PublicMats.ceiling, PublicMats.darkMetal, PublicMats.black,
    PublicMats.paper, PublicMats.signRed, featureStone, glowTexture, sconceWash, scallopWash, stripWash, clockFace,
    // rooms
    laminateTextures, damaskTextures, weaveNormal, wrinkleNormal, chevronTextures, woodLaminate,
    RoomMats.wall, RoomMats.ceiling, RoomMats.skirting, RoomMats.floor, RoomMats.sheet, RoomMats.pillow,
    RoomMats.runner, RoomMats.skirt, RoomMats.divan, RoomMats.laminate, RoomMats.gold, RoomMats.chrome,
    RoomMats.ceramic, RoomMats.mirror, RoomMats.frosted, RoomMats.tileWall, RoomMats.tileFloor,
    RoomMats.plasticGreen, RoomMats.blackGloss, RoomMats.blackMatte, RoomMats.acCream, RoomMats.phone,
    RoomMats.white, RoomMats.towel, RoomMats.bottle, RoomMats.bin,
    ...HEADS.flatMap((h) => [() => RoomMats.headboard(h), () => RoomMats.headboardSide(h)]),
    () => RoomMats.curtain('navy'), () => RoomMats.curtain('sage'),
    () => RoomMats.showerCurtain('blue'), () => RoomMats.showerCurtain('white'),
    () => RoomMats.goldLeaf('banana'), () => RoomMats.goldLeaf('wheat'),
  ];
}
