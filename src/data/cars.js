// Vehicle make/model database
const base = {
  'Alfa Romeo':['147','156','159','166','Giulia','Giulietta','Mito','Stelvio','Tonale'],
  'Aston Martin':['DB9','DB11','DBS','Rapide','Vantage','Vantage V8','Vantage V12'],
  'Audi':['A1','A2','A3','A4','A5','A6','A7','A8','Q2','Q3','Q5','Q7','Q8','TT','R8','RS3','RS4','RS5','RS6','RS7','S3','S4','S5','S6','e-tron','Q4 e-tron'],
  'Bentley':['Bentayga','Continental GT','Flying Spur','Mulsanne'],
  'BMW':['1 Series','2 Series','3 Series','4 Series','5 Series','6 Series','7 Series','8 Series','M2','M3','M4','M5','M6','M8','X1','X2','X3','X4','X5','X6','X7','Z4','i3','i4','iX','320i','330i','520i','530d','M340i'],
  'BYD':['Atto 3','Han','Seal','Tang','Dolphin','Seagull'],
  'Chevrolet':['Aveo','Blazer','Camaro','Colorado','Corvette','Cruze','Equinox','Malibu','Orlando','Silverado','Spark','Suburban','Tahoe','Trailblazer'],
  'Chrysler':['300','300C','Grand Voyager','Pacifica','Voyager'],
  'Chery':['Tiggo 4','Tiggo 7','Tiggo 8','Arrizo 5','Arrizo 6'],
  'Citroën':['Berlingo','C1','C3','C4','C5','C5 X','C8','Jumpy','Xsara'],
  'Dacia':['Duster','Jogger','Logan','Sandero','Spring'],
  'Dodge':['Challenger','Charger','Dart','Durango','Journey','Ram'],
  'Ferrari':['458','488','812','California','F430','F8','Portofino','Roma','SF90'],
  'Fiat':['124','500','500X','Bravo','Ducato','Panda','Punto','Tipo'],
  'Ford':['B-Max','C-Max','EcoSport','Edge','Everest','Explorer','F-150','Fiesta','Fiesta ST','Focus','Focus ST','Galaxy','Ka','Kuga','Maverick','Mondeo','Mustang','Puma','Ranger','S-Max','Territory','Transit'],
  'GWM':['Haval H6','Haval Jolion','P Series','Steed','Cannon','ORA Good Cat'],
  'Genesis':['G70','G80','G90','GV70','GV80'],
  'Geely':['Coolray','Emgrand','Okavango','Atlas','Boyue'],
  'Honda':['Accord','BR-V','City','Civic','CR-V','Fit','HR-V','Jazz','Odyssey','Pilot','WR-V'],
  'Hyundai':['Accent','Creta','Elantra','Grand i10','H1','i10','i20','i30','i40','Kona','Palisade','Santa Fe','Sonata','Staria','Tucson','Venue'],
  'Infiniti':['Q30','Q50','Q60','Q70','QX50','QX60','QX70','QX80'],
  'Isuzu':['D-Max','MU-X','KB 250','Trooper'],
  'JAC':['T6','S2','S3','S5'],
  'Jaguar':['E-Pace','F-Pace','F-Type','I-Pace','XE','XF','XJ'],
  'Jeep':['Cherokee','Compass','Grand Cherokee','Renegade','Wrangler'],
  'Kia':['Carnival','Cerato','Ceed','EV6','Niro','Picanto','Rio','Seltos','Sorento','Sportage','Stinger','Telluride'],
  'Lamborghini':['Aventador','Huracan','Urus'],
  'Land Rover':['Defender','Discovery','Discovery Sport','Freelander','Range Rover','Range Rover Evoque','Range Rover Sport','Range Rover Velar'],
  'Lexus':['CT','ES','GS','GX','IS','LC','LS','LX','NX','RC','RX','UX'],
  'Maserati':['Ghibli','GranTurismo','Levante','MC20','Quattroporte'],
  'Mazda':['2','3','6','BT-50','CX-3','CX-30','CX-5','CX-9','MX-5','MX-30','RX-8'],
  'McLaren':['570S','600LT','650S','720S','GT','Senna'],
  'Mercedes-Benz':['A-Class','B-Class','C-Class','CLA','CLS','E-Class','G-Class','GLA','GLB','GLC','GLE','GLS','S-Class','SL','AMG GT','C 63 AMG','E 63 AMG','G 63 AMG','EQA','EQC','EQE','EQS','Sprinter','Vito'],
  'MG':['3','5','6','ZS','HS','Gloster','RX5','One','4'],
  'MINI':['Cooper','Cooper S','Countryman','Clubman','John Cooper Works','Hatch'],
  'Mitsubishi':['ASX','Eclipse Cross','L200','Lancer','Outlander','Pajero','Pajero Sport'],
  'Nissan':['350Z','370Z','GT-R','Juke','Kicks','Leaf','Micra','Navara','Note','Pathfinder','Patrol','Qashqai','Sylphy','Tiida','X-Trail','Z'],
  'Opel':['Adam','Astra','Cascada','Corsa','Grandland','Insignia','Mokka','Zafira'],
  'Peugeot':['107','108','206','207','208','2008','301','308','3008','407','5008','508'],
  'Porsche':['718 Boxster','718 Cayman','911','Cayenne','Macan','Panamera','Taycan'],
  'RAM':['1500','2500','3500','ProMaster'],
  'Renault':['Arkana','Captur','Clio','Duster','Kadjar','Kiger','Koleos','Kwid','Laguna','Megane','Sandero','Scenic','Triber','Zoe'],
  'Rolls-Royce':['Cullinan','Dawn','Ghost','Phantom','Spectre','Wraith'],
  'SEAT':['Arona','Ateca','Ibiza','Leon','Mii','Tarraco','Toledo'],
  'Škoda':['Citigo','Fabia','Karoq','Kodiaq','Octavia','Rapid','Scala','Superb'],
  'Smart':['EQ Fortwo','Fortwo','Forfour'],
  'Subaru':['BRZ','Crosstek','Forester','Impreza','Legacy','Outback','WRX','WRX STI','XV'],
  'Suzuki':['Alto','Baleno','Ciaz','Celerio','Dzire','Ertiga','Grand Vitara','Ignis','Jimny','Swift','SX4','Vitara'],
  'Tesla':['Model 3','Model S','Model X','Model Y','Cybertruck'],
  'Toyota':['4Runner','Aqua','Avanza','Aygo','C-HR','Camry','Corolla','Corolla Cross','Fortuner','GR Yaris','GR86','Hilux','Land Cruiser','Prado','Prius','RAV4','Rush','Tacoma','Tundra','Yaris'],
  'Volkswagen':['Amarok','Arteon','Atlas','Caddy','Crafter','Golf','Golf GTI','Golf R','ID.3','ID.4','ID.5','Jetta','Multivan','Polo','Polo GTI','Scirocco','T-Cross','T-Roc','Tiguan','Touareg','Touran','Transporter','Up'],
  'Volvo':['C40','S40','S60','S90','V40','V60','V90','XC40','XC60','XC90'],
  'SsangYong':['Korando','Musso','Rexton','Tivoli'],
  'GAC':['GS4','GS5','GS8','Trumpchi'],
};

// Merge the extra list, drop duplicates (case-insensitive) and sort. Aliases map spelling variants of one make together.
const ALIAS = { 'Dodge Ram':'RAM','Ford Performance':'Ford','Genesis Coupe':'Hyundai','Great Wall Motors':'GWM','Lancia Classic':'Lancia','Mazda Rotary':'Mazda','Nissan Nismo':'Nissan','SsangYong Classic':'SsangYong','Subaru STI':'Subaru','Maruti Suzuki':'Suzuki','Mahindra Reva':'Mahindra','Isuzu Commercial':'Isuzu','Volkswagen Commercial':'Volkswagen','Chevrolet Commercial':'Chevrolet','Opel Commercial':'Opel','Aston Martin Lagonda':'Aston Martin','Renault Samsung':'Samsung','SRT':'Dodge','Corvette':'Chevrolet','Shelby':'Ford','Mercedes-Maybach':'Mercedes-Benz','SAIC':'MG','Baojun':'Wuling','Roewe':'MG','Landwind':'JMC','Genesis Coupe':'Hyundai', 'MG #2': 'MG', 'Dodge #2': 'Dodge', 'Mini': 'MINI', 'Great Wall': 'GWM', 'Mercedes-AMG': null, 'BMW M': null, 'Haval': 'GWM', 'Vauxhall': null, 'MG Classic': null, 'Skoda Classic': 'Škoda', 'Lada Classic': 'Lada', 'Tata Commercial': 'Tata', 'Hyundai Commercial': 'Hyundai', 'Kia Commercial': 'Kia', 'Fiat Professional': 'Fiat' };
const extra = require('./cars-extra');
const out = {};
const add = (make, models) => {
  const m = out[make] || (out[make] = new Map());
  for (const x of models) { const k = x.trim().toLowerCase(); if (!m.has(k)) m.set(k, x.trim()); }
};
for (const [mk, ms] of Object.entries(base)) add(mk, ms);
for (const [mk, ms] of Object.entries(extra)) add(ALIAS[mk] === undefined ? mk : ALIAS[mk] || mk, ms);
const sorted = {};
for (const mk of Object.keys(out).sort((a, b) => a.localeCompare(b))) sorted[mk] = [...out[mk].values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
module.exports = sorted;
