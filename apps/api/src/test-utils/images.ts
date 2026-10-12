// Contenus minimaux ayant la signature réelle de chaque format d'image, pour les tests
// de téléversement (le contrôle porte sur la signature, pas sur la validité de l'image).
const CHARGE = Buffer.from("contenu-image-factice");

export const PNG_FACTICE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), CHARGE]);
export const JPEG_FACTICE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), CHARGE]);
export const GIF_FACTICE = Buffer.concat([Buffer.from("GIF89a"), CHARGE]);
export const WEBP_FACTICE = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), CHARGE]);
