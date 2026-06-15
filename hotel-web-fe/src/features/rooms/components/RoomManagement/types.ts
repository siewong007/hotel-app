import React from 'react';
import { Room } from '../../../../types';

export interface RoomAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  color?: string;
  onClick: (room: Room) => void;
  secondary?: string;
  badge?: string | number;
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

export interface GuestWithCredits {
  id: number;
  full_name: string;
  email: string;
  total_complimentary_credits: number;
  credits_by_room_type: {
    room_type_id: number;
    room_type_name: string;
    room_type_code: string;
    nights_available: number;
  }[];
}
