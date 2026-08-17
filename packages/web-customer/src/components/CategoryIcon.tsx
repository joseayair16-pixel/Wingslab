import React from 'react';
import {
  Apple, Baby, Banana, Beer, Beef, Bird, BookOpen, Boxes, Building, Building2,
  Cake, Cherry, ChefHat, Citrus, Coffee, Cookie, CookingPot, Croissant, Crown,
  CupSoda, Dessert, Donut, Drumstick, Dumbbell, Egg, EggFried, Feather, Fish,
  Flag, Flame, FlaskConical, Flower, Flower2, Gift, GlassWater, Globe, Grape,
  Ham, Hamburger, Heart, Home, IceCreamCone, LayoutGrid, Leaf, Martini, Milk, Monitor,
  Package, Palmtree, PawPrint, Pill, Pizza, Rocket, Salad, Sandwich, Shirt,
  ShowerHead, Shrimp, ShoppingBag, ShoppingCart, Soup, Sparkles, Sprout, Star,
  Store, Tag, ToyBrick, Truck, Utensils, UtensilsCrossed, Weight, Wheat, Wine,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutGrid,
  Store, Gift, Pizza, Fish, Salad, Drumstick, CupSoda, Hamburger, Sandwich,
  Beef, Cake, Tag, Soup, ChefHat, Utensils, UtensilsCrossed, Sprout, Leaf,
  CookingPot, Shrimp, Flame, Flag, EggFried, Zap, Coffee, Cherry, Milk,
  GlassWater, IceCreamCone, Croissant, Wheat, Banana, Truck, Apple, Egg, Grape,
  Bird, Cookie, Donut, Citrus, Ham, Globe, Feather, Palmtree, Dessert, Shirt,
  Monitor, Heart, Flower, Sparkles, PawPrint, BookOpen, ShoppingBag, ToyBrick,
  Dumbbell, Home, Baby, Pill, Flower2, Weight, ShoppingCart, Package, Building,
  Boxes, Crown, Building2, Star, Martini, Beer, Wine, FlaskConical, ShowerHead,
  Rocket,
};

// Emojis legacy aún presentes en la base antes de re-sembrar.
const EMOJI_FALLBACK: Record<string, string> = {
  '🏪': 'Store', '🎁': 'Gift', '🍕': 'Pizza', '🍣': 'Fish', '🥗': 'Salad',
  '🍗': 'Drumstick', '🧋': 'CupSoda', '🍔': 'Hamburger', '🥪': 'Sandwich',
  '🥩': 'Beef', '🍰': 'Cake', '🏷️': 'Tag', '🍜': 'Soup', '🌮': 'ChefHat',
  '🥡': 'Utensils', '🥢': 'UtensilsCrossed', '🥦': 'Sprout', '🍝': 'CookingPot',
  '🦐': 'Shrimp', '🍲': 'Flame', '🍟': 'Flag', '🍳': 'EggFried', '☕': 'Coffee',
  '🍱': 'Cherry', '🥤': 'GlassWater', '🍨': 'IceCreamCone', '🥐': 'Croissant',
  '🍍': 'Banana', '👖': 'Shirt', '🖥️': 'Monitor', '❤️': 'Heart', '💐': 'Flower',
  '💄': 'Sparkles', '🐾': 'PawPrint', '📚': 'BookOpen', '🛍️': 'ShoppingBag',
  '🧸': 'ToyBrick', '🏋️': 'Dumbbell', '🏠': 'Home', '🍼': 'Baby', '💊': 'Pill',
  '✨': 'Flower2', '💪': 'Weight', '🛒': 'ShoppingCart', '⚡': 'Zap',
  '🏬': 'Building', '📦': 'Boxes', '👑': 'Crown', '🏢': 'Building2',
  '🆕': 'Star', '🍸': 'Martini', '🍺': 'Beer', '🍷': 'Wine', '🍾': 'FlaskConical',
  '🧴': 'ShowerHead',
};

interface CategoryIconProps {
  name: string;
  className?: string;
}

export function CategoryIcon({ name, className }: CategoryIconProps) {
  const iconName = ICON_MAP[name] ? name : EMOJI_FALLBACK[name];
  const Icon = iconName ? ICON_MAP[iconName] : undefined;
  if (Icon) return <Icon className={className} aria-hidden="true" />;
  return <span className={className}>{name}</span>;
}
