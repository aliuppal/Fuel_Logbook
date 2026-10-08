// Common cars in Pakistan and the US with a typical fuel average in km per liter.
// US figures are EPA combined ratings (mpg × 0.4251); Pakistan has no official
// ratings, so those are typical owner averages in mixed city/highway driving.
// They are a starting point: each car's average can be changed when it's added.
// Rows: [make, model, engine, km/L]

export const MARKETS = { PK: "Pakistan", US: "United States", other: "Other" };

export const CAR_CATALOG = {
  PK: [
    ["Suzuki", "Alto", "660cc", 20], ["Suzuki", "Alto", "800cc (old)", 17], ["Suzuki", "Mehran", "800cc", 16],
    ["Suzuki", "Cultus", "1.0L", 17], ["Suzuki", "Wagon R", "1.0L", 17], ["Suzuki", "Swift", "1.2L", 16],
    ["Suzuki", "Ciaz", "1.4L", 15], ["Suzuki", "Bolan", "800cc", 13], ["Suzuki", "Every", "660cc", 15],
    ["Suzuki", "Vitara", "1.6L", 12], ["Suzuki", "Jimny", "1.5L", 11],
    ["Toyota", "Corolla", "1.3L (XLi / GLi)", 13], ["Toyota", "Corolla", "1.6L (Altis)", 12], ["Toyota", "Corolla", "1.8L (Altis Grande)", 11],
    ["Toyota", "Yaris", "1.3L", 15], ["Toyota", "Yaris", "1.5L", 14], ["Toyota", "Corolla Cross", "1.8L Hybrid", 18],
    ["Toyota", "Fortuner", "2.7L Petrol", 8], ["Toyota", "Fortuner", "2.8L Diesel", 10], ["Toyota", "Hilux Revo", "2.8L Diesel", 10],
    ["Toyota", "Prius", "1.8L Hybrid", 22], ["Toyota", "Aqua", "1.5L Hybrid", 22], ["Toyota", "Vitz", "1.0L", 18], ["Toyota", "Passo", "1.0L", 18],
    ["Honda", "City", "1.2L", 15], ["Honda", "City", "1.5L", 14], ["Honda", "Civic", "1.5L Turbo", 12], ["Honda", "Civic", "1.8L", 11],
    ["Honda", "BR-V", "1.5L", 13], ["Honda", "HR-V", "1.5L", 13], ["Honda", "HR-V", "1.5L e:HEV Hybrid", 20],
    ["Honda", "Vezel", "1.5L Hybrid", 18], ["Honda", "Fit", "1.5L Hybrid", 20], ["Honda", "N-WGN", "660cc", 18],
    ["Kia", "Picanto", "1.0L", 16], ["Kia", "Stonic", "1.4L", 14], ["Kia", "Sportage", "2.0L", 10], ["Kia", "Sorento", "2.4L", 9],
    ["Hyundai", "Elantra", "1.6L", 13], ["Hyundai", "Elantra", "2.0L", 11], ["Hyundai", "Tucson", "2.0L", 10],
    ["Hyundai", "Sonata", "2.0L", 10], ["Hyundai", "Sonata", "2.5L", 10], ["Hyundai", "Santa Fe", "2.5L", 9],
    ["Changan", "Alsvin", "1.3L", 15], ["Changan", "Alsvin", "1.5L", 14], ["Changan", "Karvaan", "1.2L", 12], ["Changan", "Oshan X7", "1.5L Turbo", 10],
    ["MG", "HS", "1.5L Turbo", 10], ["MG", "ZS", "1.5L", 12], ["MG", "5", "1.5L", 14],
    ["Haval", "H6", "1.5L Turbo", 10], ["Haval", "H6", "1.5L Turbo Hybrid", 16], ["Haval", "Jolion", "1.5L Turbo", 11],
    ["Proton", "Saga", "1.3L", 14], ["Proton", "X70", "1.8L Turbo", 9],
    ["Chery", "Tiggo 4 Pro", "1.5L Turbo", 11], ["Chery", "Tiggo 8 Pro", "1.6L Turbo", 9],
    ["Peugeot", "2008", "1.2L Turbo", 13], ["DFSK", "Glory 580", "1.5L Turbo", 9],
    ["Daihatsu", "Mira", "660cc", 22], ["Daihatsu", "Cuore", "850cc", 17],
  ],
  US: [
    ["Toyota", "Camry", "2.5L", 13.6], ["Toyota", "Camry", "2.5L Hybrid", 22.1], ["Toyota", "Corolla", "2.0L", 14.9],
    ["Toyota", "Corolla", "1.8L Hybrid", 21.3], ["Toyota", "RAV4", "2.5L", 12.8], ["Toyota", "RAV4", "2.5L Hybrid", 16.6],
    ["Toyota", "Highlander", "2.4L Turbo", 10.2], ["Toyota", "Highlander", "2.5L Hybrid", 14.9], ["Toyota", "Tacoma", "2.4L Turbo", 8.9],
    ["Toyota", "Tundra", "3.4L Twin-Turbo V6", 8.5], ["Toyota", "Prius", "2.0L Hybrid", 24.2], ["Toyota", "4Runner", "4.0L V6", 7.2],
    ["Honda", "Civic", "2.0L", 15.3], ["Honda", "Civic", "1.5L Turbo", 15.3], ["Honda", "Accord", "1.5L Turbo", 13.6],
    ["Honda", "Accord", "2.0L Hybrid", 20.4], ["Honda", "CR-V", "1.5L Turbo", 12.8], ["Honda", "CR-V", "2.0L Hybrid", 17.0],
    ["Honda", "HR-V", "2.0L", 11.9], ["Honda", "Pilot", "3.5L V6", 9.4],
    ["Ford", "F-150", "2.7L EcoBoost V6", 9.4], ["Ford", "F-150", "3.5L EcoBoost V6", 8.5], ["Ford", "F-150", "5.0L V8", 8.1],
    ["Ford", "Escape", "1.5L EcoBoost", 12.8], ["Ford", "Explorer", "2.3L EcoBoost", 10.2], ["Ford", "Ranger", "2.3L EcoBoost", 9.4],
    ["Ford", "Bronco", "2.3L EcoBoost", 8.5], ["Ford", "Mustang", "2.3L EcoBoost", 10.6], ["Ford", "Mustang", "5.0L V8", 8.1],
    ["Chevrolet", "Silverado 1500", "2.7L Turbo", 8.5], ["Chevrolet", "Silverado 1500", "5.3L V8", 7.7], ["Chevrolet", "Equinox", "1.5L Turbo", 11.9],
    ["Chevrolet", "Malibu", "1.5L Turbo", 13.2], ["Chevrolet", "Trax", "1.2L Turbo", 12.8], ["Chevrolet", "Traverse", "2.5L Turbo", 9.4],
    ["Chevrolet", "Tahoe", "5.3L V8", 7.2], ["GMC", "Sierra 1500", "5.3L V8", 7.7],
    ["Ram", "1500", "3.6L V6 eTorque", 9.8], ["Ram", "1500", "5.7L HEMI V8", 8.1],
    ["Jeep", "Wrangler", "2.0L Turbo", 9.4], ["Jeep", "Wrangler", "3.6L V6", 8.5], ["Jeep", "Grand Cherokee", "3.6L V6", 9.4],
    ["Nissan", "Sentra", "2.0L", 14.5], ["Nissan", "Altima", "2.5L", 13.6], ["Nissan", "Rogue", "1.5L Turbo", 14.0], ["Nissan", "Kicks", "1.6L", 14.0],
    ["Hyundai", "Elantra", "2.0L", 15.3], ["Hyundai", "Elantra", "1.6L Hybrid", 23.0], ["Hyundai", "Sonata", "2.5L", 13.6],
    ["Hyundai", "Tucson", "2.5L", 11.9], ["Hyundai", "Tucson", "1.6L Turbo Hybrid", 16.2], ["Hyundai", "Santa Fe", "2.5L Turbo", 10.2],
    ["Kia", "Forte", "2.0L", 14.5], ["Kia", "K5", "1.6L Turbo", 13.2], ["Kia", "Sportage", "2.5L", 11.9],
    ["Kia", "Sorento", "2.5L", 11.1], ["Kia", "Telluride", "3.8L V6", 9.8],
    ["Subaru", "Crosstrek", "2.5L", 12.3], ["Subaru", "Forester", "2.5L", 12.3], ["Subaru", "Outback", "2.5L", 11.9],
    ["Mazda", "Mazda3", "2.5L", 13.2], ["Mazda", "CX-5", "2.5L", 11.9], ["Mazda", "CX-50", "2.5L", 11.5],
    ["Volkswagen", "Jetta", "1.5L Turbo", 14.5], ["Volkswagen", "Tiguan", "2.0L Turbo", 10.6],
  ],
};

export const makesFor = market => [...new Set((CAR_CATALOG[market] || []).map(r => r[0]))].sort();
export const modelsFor = (market, make) => [...new Set((CAR_CATALOG[market] || []).filter(r => r[0] === make).map(r => r[1]))];
export const enginesFor = (market, make, model) => (CAR_CATALOG[market] || []).filter(r => r[0] === make && r[1] === model).map(r => ({ engine: r[2], kmpl: r[3] }));
