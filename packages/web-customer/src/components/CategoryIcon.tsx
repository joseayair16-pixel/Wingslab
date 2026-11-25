import { resolveCategoryIcon } from '@sadel/shared';
import { BeerStein, BowlFood, Bread, Cake, Carrot, Coffee, CookingPot, Cookie, Drop, Egg, Fire, Fish, ForkKnife, Gift, Hamburger, IceCream, Leaf, Martini, Package, PintGlass, Pizza, Plant, PlusCircle, Popcorn, ShoppingBag, Sparkle, Star, Storefront, Tag, Wine, type Icon } from '@phosphor-icons/react';

// Legacy IDs stay valid; generic choices are inferred from the category name.
const icons: Record<string, Icon> = {
  Apple: Leaf, Banana: Leaf, Beef: BowlFood, Beer: BeerStein, Cake, Candy: Cookie,
  Carrot, Cherry: Leaf, Citrus: Leaf, Coffee, Cookie, CookingPot, Croissant: Bread,
  CupSoda: PintGlass, Donut: Cookie, Droplet: Drop, Drumstick: BowlFood, Egg, Fish,
  Flame: Fire, Gift, GlassWater: Drop, Grape: Leaf, Hamburger, IceCreamCone: IceCream,
  Leaf, Martini, Milk: Coffee, Package, Pizza, Popcorn, Salad: BowlFood, Sandwich: Bread,
  ShoppingBag, Soup: BowlFood, Sparkles: Sparkle, Sprout: Plant, Star, Store: Storefront,
  Tag, Utensils: ForkKnife, UtensilsCrossed: ForkKnife, Wine,
};

function inferIcon(categoryName: string): Icon {
  const name = categoryName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/hamburg|burger/.test(name)) return Hamburger;
  if (/sandwich|sandwiches|hot.?dog|torta/.test(name)) return Bread;
  if (/shake|malteada|batido|helado/.test(name)) return IceCream;
  if (/cafe|te\b/.test(name)) return Coffee;
  if (/bebida|refresco|agua|jugo/.test(name)) return PintGlass;
  if (/pizza/.test(name)) return Pizza;
  if (/alita|pollo|boneless|combo|side|acompan|papa/.test(name)) return BowlFood;
  if (/extra|adicional|salsa/.test(name)) return PlusCircle;
  if (/postre|pastel/.test(name)) return Cake;
  if (/ensalada|vegetal/.test(name)) return Leaf;
  return ForkKnife;
}

/** Local MIT-licensed Phosphor SVGs, with a neutral fallback for unknown categories. */
export function CategoryIcon({ name, categoryName }: { name?: string | null; categoryName: string }) {
  const category = categoryName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const artwork = /sandwich|hamburg|burger/.test(category) ? 'sandwich'
    : /combo/.test(category) ? 'combo'
    : /side|acompan|papas/.test(category) ? 'sides'
    : /shake|malteada|batido/.test(category) ? 'shake-icon'
    : /bebida|refresco/.test(category) ? 'beverage'
    : /extra|adicional|salsa/.test(category) ? 'extras' : null;
  if (artwork) {
    return <img src={`/category-art.svg#${artwork}`} width={48} height={48} alt="" draggable={false} />;
  }
  const resolved = name ? resolveCategoryIcon(name) : '';
  const IconComponent = resolved && resolved !== 'Utensils' && resolved !== 'UtensilsCrossed'
    ? icons[resolved] || inferIcon(categoryName)
    : inferIcon(categoryName);
  return <IconComponent aria-hidden="true" weight="duotone" />;
}
