import React from 'react';
import { Room } from '../../../../types';

export interface RoomAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color?: string;
  onClick: (room: Room) => void;
  secondary?: string;
}

export interface MenuSection {
  title: string;
  actions: RoomAction[];
}

export interface MenuLayout {
  primary?: {
    label: string;
    icon: React.ReactNode;
    onClick: (room: Room) => void;
    color?: 'primary' | 'success' | 'error' | 'warning' | 'info';
    dark?: boolean;
  };
  sections: MenuSection[];
}

// Either a mouse event (click position) or an explicit anchor point, so the
// context menu can be opened from the keyboard as well as the pointer.
export type RoomMenuAnchor = React.MouseEvent<HTMLElement> | { top: number; left: number };
