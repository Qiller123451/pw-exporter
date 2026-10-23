// What the interface says of the sequel's classes (game/sequel/rules.js; docs/SEQUEL.md): the build menu's tooltip
// (medium: the short points, long: the description) and the selection. vs: strong (+) or weak (-) against characters,
// animals, vehicles and buildings, like the original's cards. A class without an entry keeps its original's texts.
// intro: [speaker, line] - how the radio brings it in, in the mission that unlocks it (missions.js unlocks);
// where: where it is built (the notice that goes with it).
export const SEQUEL_TEXTS = {
  // ---------------------------------------------------------------- infantry
  sq_trooper: {
    intro: ['halloran', 'Containment Troopers train at the barracks: our riflemen. Keep them together, and between the creatures and the people.'], where: 'at the barracks',
    medium: '• Infantry\n\n• Ranged unit',
    long: 'The backbone of the containment teams: riflemen of the 1964 SEAS, trained to hold a street against anything that comes out of a rift.',
  },
  sq_tranq: {
    intro: ['booker', 'Tranquilizer Marksmen: a dart keeps the animal from dying. Hit it with one, then wear it down with anything you\'ve got - when it should drop dead, it drops asleep. That\'s when we can take it.'], where: 'at the barracks',
    medium: '• Infantry\n\n• Tranquilizer darts: a creature hit by one falls asleep instead of dying for 30 s',
    long: 'Marksmen with dart rifles. A dart tranquilizes the creature it hits for 30 seconds: a blow that would kill it then - from the darts or from any other weapon - leaves it asleep at 1 hit point instead. The darts strike five times as hard on a creature held by an electrified net. A sleeper is left alone - no blow reaches it, and nobody attacks it. A Capture Truck can then load it and take it to a pen (or, where there is none, to the garage or the headquarters).',
    vs: { chtr: '-', anml: '+', vhcl: '-', bldg: '-' },
  },
  sq_shock_trooper: {
    intro: ['taslov', 'My arc rifles are ready: Shock Troopers. Every hit locks the target\'s muscles for a moment. They are paid in power, not wood.'], where: 'at the barracks',
    medium: '• Infantry\n\n• Ranged unit\n\n• Every hit stuns for a moment\n\n• Costs power',
    long: "Troopers carrying Taslov's arc rifle, fed from a battery pack charged at the base. Each hit locks the target's muscles for a moment, which stops a charging raptor in its tracks.",
  },
  // ---------------------------------------------------------------- machines
  sq_jeep: {
    intro: ['kiko', 'You\'ve got Recon Jeeps now - fast, a machine gun, good eyes. Find the herds and the rifts before they find you.'], where: 'at the garage',
    medium: '• Vehicle\n\n• Fast scout\n\n• Machine gun',
    long: 'A light four-wheel-drive car with a mounted machine gun. The fastest thing SEAS owns on the ground: it finds the rifts and the herds, and it gets away again.',
    vs: { chtr: '+', anml: '+', vhcl: '-', bldg: '-' },
  },
  sq_capture_truck: {
    intro: ['booker', 'Capture Trucks: drive one next to a sleeping animal and it loads it. Bring it to a pen and the animal is ours.'], where: 'at the garage',
    medium: '• Vehicle\n\n• Unarmed\n\n• Loads a sleeping animal and carries it to a pen (or the garage)',
    long: 'A six-wheeled truck with a steel cage. Drive it next to an animal put to sleep by tranquilizer darts and it loads it; at a pen - or, where there is none, at the garage or the headquarters - the animal becomes yours.',
  },
  sq_aa_halftrack: {
    intro: ['halloran', 'Flak Halftracks: they outrange anything on the ground and bring down whatever comes out of the rift on wings.'], where: 'at the garage',
    medium: '• Vehicle\n\n• Ranged unit\n\n• Long range, good against flying creatures',
    long: 'A halftrack with a quad flak mount. It outranges every creature on the ground and brings down whatever comes out of the rift on wings.',
    vs: { chtr: '+', anml: '+', vhcl: '-', bldg: '-' },
  },
  sq_arc_halftrack: {
    intro: ['taslov', 'An arc projector on a halftrack. Its bolt stuns and jumps to two more enemies - the answer to a pack. It runs on power.'], where: 'at the garage',
    medium: '• Vehicle\n\n• Ranged unit\n\n• Lightning jumps to two more enemies\n\n• Costs power',
    long: "A halftrack carrying one of Taslov's arc projectors. Its bolt stuns the target and jumps on to two more enemies nearby, at less strength each time - the answer to a pack.",
    vs: { chtr: '+', anml: '+', vhcl: '+', bldg: '-' },
  },
  // ---------------------------------------------------------------- structures
  sq_stabilizer: {
    intro: ['taslov', 'A Rift Stabilizer seals a rift within thirty metres of it - if it survives the minute it needs.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Seals a rift nearby',
    long: 'A field resonator of Taslov\'s design. Built within about 30 m of a rift, it closes it after a while; the rift fights back with everything it has until it is sealed. Keep the creatures off it.',
  },
  sq_searchlight: {
    intro: ['halloran', 'Searchlight Towers light the night around them, and whatever is caught in the beam stands dazzled. They cost power to build.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Lights the night\n\n• Dazzles creatures in its beam\n\n• Costs power',
    long: 'A tower with an arc lamp. At night it lights the ground around it, and the creatures caught in its beam are dazzled and stand still.',
  },
  sq_flak: {
    intro: ['halloran', 'Engineers can dig in Gun Emplacements - a heavy machine gun behind sandbags, cheap and quick where a line has to hold.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Attacks on sight',
    long: 'A sandbagged gun emplacement with a heavy machine gun. Cheap and quick to dig in where a line has to hold.',
    vs: { chtr: '+', anml: '+', vhcl: '-', bldg: '-' },
  },
  sq_radar: {
    intro: ['kiko', 'Radar Stations watch a wide circle around them. Nothing comes out of the dark unseen.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Sees very far',
    long: 'A radar dish on a prefabricated hut. It watches a wide circle around it, so that nothing comes out of the dark unseen.',
  },
  sq_field_hq: {
    medium: '• Building\n\n• A command post\n\n• Power lines can end here',
    long: 'A forward command post. Like the headquarters, it takes the power of the lines that reach it.',
  },
  sq_electric_net: {
    intro: ['taslov', 'My Electrified Nets: the first creature that steps on one is held fast for fifteen seconds - and my darts hit it five times as hard then. Thirty seconds to charge again, and they cost power.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Holds a creature for 15 s\n\n• Costs power',
    long: "Taslov's electrified net. The first creature that steps on it is held fast for 15 seconds - and tranquilizer darts hit it five times as hard meanwhile. It needs 30 seconds to charge again.",
  },
  // ---------------------------------------------------------------- electricity
  sq_power_station: {
    medium: '• Power plant\n\n• Up to 6 workers\n\n• Needs a power line to the base',
    long: "The town's generating station. Abandoned ones become yours as soon as one of your units reaches them. Its workers make power, which reaches the stockpile only while a line of power poles connects it to the headquarters or a command post.",
  },
  sq_power_pole: {
    intro: ['taslov', 'Power Poles carry the current. A plant only delivers while a chain of poles, no more than forty metres apart, reaches the headquarters or a command post. Lose a pole and everything behind it goes dark.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Carries the power line (at most 40 m to the next)',
    long: 'A wooden pole with the wires of the line. A plant delivers only while a chain of poles, no more than 40 m apart, connects it to the headquarters or a command post. A pole that falls cuts off everything behind it - the creatures know it.',
  },
  sq_generator: {
    intro: ['taslov', 'A Diesel Generator makes a little power anywhere: two workers keep it running. Connect it to the line like the station.'], where: 'in the engineers\' build menu',
    medium: '• Power plant\n\n• Up to 2 workers\n\n• Needs a power line to the base',
    long: 'A diesel generator set. Small and cheap, it makes power wherever two workers tend it.',
  },
  sq_windmill: {
    intro: ['taslov', 'Wind Chargers need nobody - they turn by themselves, day and night. Not much power, but it never stops. They need the line too.'], where: 'in the engineers\' build menu',
    medium: '• Power plant\n\n• Needs no workers\n\n• Needs a power line to the base',
    long: 'A farm wind charger on a steel tower. It makes a little power by itself, day and night.',
  },
  sq_watermill: {
    intro: ['taslov', 'Water Wheels go on the shore. They turn on their own, and two workers make them give much more. Poles to the base, as always.'], where: 'in the engineers\' build menu, at the water',
    medium: '• Power plant\n\n• Up to 2 workers\n\n• Built on the shore\n\n• Needs a power line to the base',
    long: 'A water wheel with a dynamo, built at the water. It turns by itself; workers make it give much more.',
  },
  sq_tesla_coil: {
    intro: ['taslov', 'Tesla Coils: lightning on whatever comes near the base, and it jumps on to two more. They need power to build.'], where: 'in the engineers\' build menu',
    medium: '• Building\n\n• Attacks on sight\n\n• Lightning jumps to two more enemies\n\n• Costs power',
    long: "Taslov's coil. It strikes whatever comes near, and the lightning jumps on to two more enemies.",
    vs: { chtr: '+', anml: '+', vhcl: '+', bldg: '-' },
  },
  sq_launch_pad: { medium: '• Building', long: 'Launch Complex 34 at Cape Canaveral, with its rocket on the launch table.' },
  sq_gate_machine: { medium: '• Building', long: "Taslov's Gate machine, built around the core taken from the temple. Fully charged, it pulls every rift on Earth shut at once." },
  sq_rift: { medium: '• A tear between the worlds', long: 'Creatures come through it in waves while it is open. A Rift Stabilizer built near it seals it.' },
  // ---------------------------------------------------------------- people of the story
  sq_civilian_1: { medium: '• Civilian', long: 'A townsperson caught in the outbreak. Lead them to safety.' },
  sq_civilian_2: { medium: '• Civilian', long: 'A townsperson caught in the outbreak. Lead them to safety.' },
  sq_civilian_3: { medium: '• Civilian', long: 'A townsperson caught in the outbreak. Lead them to safety.' },
  sq_civilian_4: { medium: '• Civilian', long: 'A townsperson caught in the outbreak. Lead them to safety.' },
  sq_big_tooth: { medium: '• Animal\n\n• Huge', long: 'The giant of the rift. Bullets barely bother it: hold it in a net and dart it.' },
  sq_old_scar: { medium: '• Animal\n\n• Huge', long: 'The one-eyed king of Crane\'s old menagerie: the oldest and meanest animal he ever caught. It leads the pack.' },
  sq_cargo_truck: { medium: '• Vehicle\n\n• Unarmed\n\n• Drives with the convoy', long: 'A heavy Army truck of the convoy. It keeps to the road and stops when it is in danger.' },
  sq_rift_engine: { medium: '• Crane\'s machine\n\n• Holds a rift open', long: 'Crane\'s copy of the Gate machine, crude and loud. While it runs, the rift beside it stays open.' },
  sq_relay_mast: { medium: '• Crane\'s machine\n\n• Shields the Behemoth', long: 'A radio mast feeding power to the Behemoth\'s field generator. While any mast stands, the Behemoth cannot be hurt.' },
  sq_behemoth: { medium: '• Vehicle\n\n• Huge', long: 'Crane\'s last machine: a walking fortress on six legs, built from the spider walkers of the old SEAS.' },
  // the heroes keep their originals' level lines (what each level gives, MIRAGE's: they cover SEAS)
  sq_halloran: { long: 'Colonel Margaret "Peg" Halloran, SEAS field commander and former Army engineer.' },
  sq_taslov: { long: 'Dr. Lev Taslov, rift physicist and grandson of the inventor Taslov. He builds the Rift Stabilizers.' },
  sq_booker: { long: 'Sergeant Elijah "Eli" Booker, handler of the tamed-dinosaur corps.' },
  sq_tala: { long: 'Tala, war leader of a Dustrider band pulled through a rift: first an enemy, then an ally.' },
  sq_crane: { long: 'Augustus Crane, a former SEAS director who sees the rifts as an opportunity, with a private army of his own.' },
};
