// 10.1 : « jusqu'à 2 utilisateurs simultanés » (formule Essentiel). Les sessions sont des jetons que le serveur ne conserve pas : « connecté »
// veut donc dire « a utilisé l'application depuis moins de quinze minutes ». Tenu en mémoire : un redémarrage libère toutes les places.
export const DUREE_INACTIVITE_MS = 15 * 60 * 1000;

export function creerRegistrePlaces(inactiviteMs = DUREE_INACTIVITE_MS) {
  const derniereActivite = new Map<number, number>();

  return {
    // prend ou garde une place pour cet utilisateur ; faux s'il n'y en a plus. Un utilisateur prioritaire entre toujours, et compte ensuite.
    occuper(idUser: number, maximum: number, prioritaire = false, maintenant = Date.now()): boolean {
      for (const [id, vu] of derniereActivite) if (maintenant - vu >= inactiviteMs) derniereActivite.delete(id);
      if (!derniereActivite.has(idUser) && !prioritaire && derniereActivite.size >= maximum) return false;
      derniereActivite.set(idUser, maintenant);
      return true;
    },
    liberer(idUser: number): void {
      derniereActivite.delete(idUser);
    },
  };
}

export type RegistrePlaces = ReturnType<typeof creerRegistrePlaces>;
