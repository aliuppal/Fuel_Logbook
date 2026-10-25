-- Fuel grade per fill-up. Pakistan cars record normal petrol or high octane; US cars
-- record the pump grade (regular 87, mid-grade 89, premium 91–93), diesel or E85.

alter table public.fuel_fillups
  add column fuel_grade text not null default 'regular'
  check (fuel_grade in ('regular', 'high_octane', 'midgrade', 'premium', 'diesel', 'e85'));
