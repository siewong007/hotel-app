export type IndexExperience = 'salim-inn-model';

/**
 * The index route ("/") always shows the public Salim Inn experience — signed
 * in or not. A signed-in visitor keeps their session on the index page; its
 * header links send guest accounts to /guest-portal and staff accounts to
 * /admin-portal (see salim-inn/index.html's `?account=` handling).
 */
export function resolveIndexExperience(): IndexExperience {
  return 'salim-inn-model';
}
