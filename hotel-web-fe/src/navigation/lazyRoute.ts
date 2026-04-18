import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export type PreloadableRouteComponent<T extends ComponentType<any> = ComponentType<any>> =
  LazyExoticComponent<T> & {
    preload: () => Promise<unknown>;
  };

export function lazyRoute<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>
): PreloadableRouteComponent<T> {
  const Component = lazy(loader) as PreloadableRouteComponent<T>;
  Component.preload = loader;
  return Component;
}
