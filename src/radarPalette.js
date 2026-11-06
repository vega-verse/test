// IEM NEXRAD N0Q / HRRR REFD color table (identical for both), extracted from the PLTE chunk of
// https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.png
// Index i  <->  reflectivity dBZ = i * 0.5 - 32. All 256 colors are distinct, and the map tiles use
// these exact colors (no blending), so a tile pixel decodes to its dBZ value exactly.
const HEX =
  '00000085718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e' +
  '8f847c8f857c90877b918879918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976' +
  'adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4' +
  'c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4' +
  '949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a2' +
  '4b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d4' +
  '62bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c816' +
  '10c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d' +
  '0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05d6c704' +
  'ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400' +
  'ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000' +
  'a300009b00009400008d00007f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dff' +
  'ff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef' +
  '8800ea8300e87900e27200dd6900db05ecf005ebf005eaf005dde005dce005dbe005cdd005ccd004bdc004bcc004bbc0' +
  '04aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80037d80036f70036e70036d70025f60025e60024f50' +
  '024e50024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5'

/** packed 0xRRGGBB -> palette index */
export const COLOR_TO_INDEX = new Map()
for (let i = 0; i < 256; i++) COLOR_TO_INDEX.set(parseInt(HEX.slice(i * 6, i * 6 + 6), 16), i)

export const indexToDbz = (i) => i * 0.5 - 32
export const dbzToIndex = (dbz) => Math.round((dbz + 32) * 2)
export const indexColor = (i) => '#' + HEX.slice(i * 6, i * 6 + 6)
