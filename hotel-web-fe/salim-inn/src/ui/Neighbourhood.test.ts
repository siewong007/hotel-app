// The map's floating markers (brief 2026-10-13, part 7): the hotel's own
// marker leads — its brand mark and its name, never a control — each category
// carries its own icon, an open card marks its marker selected and steps the
// others back, and a marker that would cover the hotel's gives way to it.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupsWith, places, type Place } from '../data/neighbourhood';
import { POINTS } from '../world/layout';
import { Neighbourhood } from './Neighbourhood';

const el = (id: string) => document.getElementById(id)!;
const marker = (group: string) => document.querySelector<HTMLElement>(`.nb-marker[data-group="${group}"]`)!;

describe('the map markers', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="chapter__copy"><div id="nb-ch2"></div></div><div id="nb-ch7"></div>';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // every place 80 m east of the door unless a test says otherwise
  const make = (anchorOf: (p: Place) => THREE.Vector3 | null = () => POINTS.lobbyDoor.clone().add(new THREE.Vector3(80, 10, 0)), hotel: THREE.Vector3 | null = POINTS.pin) =>
    new Neighbourhood(places(), { ch2: el('nb-ch2'), ch7: el('nb-ch7') }, { door: POINTS.lobbyDoor, hotel: hotel ?? undefined, anchorOf });

  it('leads with the hotel’s own marker: its brand mark and its name, not a control', () => {
    make();
    const layer = document.querySelector('.nb-layer')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    const hotel = layer.firstElementChild as HTMLElement;
    expect(hotel.className).toBe('nb-hotel');
    expect(hotel.tagName).toBe('DIV');
    expect(hotel.querySelector('button, a, [tabindex]')).toBeNull();
    expect(hotel.querySelector('.nb-hotel__label')!.textContent).toBe('Salim Inn');
    expect(hotel.querySelector('.nb-hotel__pin svg')!.getAttribute('aria-hidden')).toBe('true');
    document.querySelector('.nb-layer')!.remove();
    make(undefined, null);
    expect(document.querySelector('.nb-hotel')).toBeNull(); // no point for it, no marker
  });

  it('gives every category its own icon, in the copy’s order', () => {
    make();
    const markers = [...document.querySelectorAll<HTMLElement>('.nb-marker')];
    expect(markers.map((m) => m.dataset.group)).toEqual(groupsWith(places()).map((g) => g.key));
    const icons = markers.map((m) => m.querySelector('.nb-marker__dot svg')!);
    icons.forEach((svg) => expect(svg.getAttribute('aria-hidden')).toBe('true'));
    expect(new Set(icons.map((svg) => svg.innerHTML)).size).toBe(markers.length);
  });

  it('marks the open category selected and steps the others back, and lets go on closing', () => {
    make();
    const layer = document.querySelector('.nb-layer')!;
    const chip = document.querySelector<HTMLButtonElement>('.nb-chip[data-group="food"]')!;
    chip.click();
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(layer.classList.contains('has-open')).toBe(true);
    expect(marker('food').classList.contains('is-open')).toBe(true);
    expect(marker('groceries').classList.contains('is-open')).toBe(false);
    marker('groceries').click(); // the marker opens the same card as its chip
    expect(marker('groceries').classList.contains('is-open')).toBe(true);
    expect(marker('food').classList.contains('is-open')).toBe(false);
    marker('groceries').click();
    expect(layer.classList.contains('has-open')).toBe(false);
  });

  it('keeps the hotel’s marker clear: a category on top of it gives way, in chapter 2 and chapter 7', () => {
    // the food places stand on the hotel's own point; the rest 60 m east
    const nb = make((p) => (p.group === 'food' ? POINTS.pin.clone() : POINTS.pin.clone().add(new THREE.Vector3(60, 0, 0))));
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(70);
    const camera = new THREE.PerspectiveCamera(40, 1440 / 900, 1, 5000);
    camera.position.copy(POINTS.pin).add(new THREE.Vector3(0, 260, 260));
    camera.lookAt(POINTS.pin);
    camera.updateMatrixWorld();
    const rings = { centre: POINTS.lobbyDoor, radii: [0, 0, 0], look: POINTS.pin };
    const hotel = document.querySelector<HTMLElement>('.nb-hotel')!;
    nb.update(camera, 0.25, 1440, 900, rings); // chapter 2
    expect(hotel.style.visibility).toBe('visible');
    expect(hotel.style.transform).toBe('translate3d(720.0px, 450.0px, 0)'); // the pin's tip on the point
    expect(marker('food').style.visibility).toBe('hidden');
    expect(marker('groceries').style.visibility).toBe('visible');
    nb.update(camera, 0.94, 1440, 900, rings); // chapter 7: the walking labels' turn
    expect(hotel.style.visibility).toBe('visible');
    expect(marker('groceries').style.visibility).toBe('hidden');
  });
});
