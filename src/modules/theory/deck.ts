/**
 * Theory and physics flashcards (Blake, 2026-10-31): 120 starter cards,
 * off-instrument and silent, for pocket bursts (work hours included).
 *
 * Copyright: every card is written in our own words about facts. Nothing is
 * quoted or paraphrased line by line from either book, and no figure is
 * reproduced. Each card names where its topic is covered:
 *   - Benade, Fundamentals of Musical Acoustics (Dover, 2nd rev. ed. 1990)
 *   - Winer, The Audio Expert, 2nd ed. (Routledge, 2018)
 *   - or "general" when neither book covers it (guitar-theory systems such
 *     as CAGED and modes, cassette types, a specific tape machine's habits).
 * Chapter numbers and titles: see CHAPTERS below and docs/API.md. The
 * citation points to where the subject is treated; check facts against
 * your own copies.
 *
 * Content lives in code, not in the log: the log keeps only each card's id
 * and topic, so a corrected card reaches every device with the app.
 */

export type Book = 'benade' | 'winer';
export type Source = { readonly book: Book; readonly chapter: number } | { readonly book: 'general'; readonly note: string };

/** Chapter titles, verified from publisher and retailer contents listings (2026-10-31). */
export const CHAPTERS: Readonly<Record<Book, Readonly<Record<number, string>>>> = {
  benade: {
    1: 'Preliminaries to a Study of Musical Acoustics',
    2: 'Impulsive Sounds, Alone and in Sequence',
    3: 'Simple Relations of Sounds and Motions',
    4: 'Characteristic Frequencies and the Decay of Composite Sound',
    5: 'Pitch: The Simplest Musical Implication of Characteristic Oscillations',
    6: 'The Modes of Oscillation of Simple and Composite Systems',
    7: 'Introduction to Vibration Recipes: The Plucked Strings',
    8: 'Broad Hammer and Plectra, Soft Hammers, and the Stiffness of Strings',
    9: 'The Vibrations of Drumheads and Soundboards',
    10: 'Sinusoidally Driven Oscillations',
    11: 'Room Acoustics I: Excitation of the Modes and the Transmission of Impulses',
    12: 'Room Acoustics II: The Listener and the Room',
    13: 'The Loudness of Single and Combined Sounds',
    14: 'The Acoustical Phenomena Governing the Musical Relationships of Pitch',
    15: 'Successive Tones: Reverberations, Melodic Relationships, and Musical Scales',
    16: 'Keyboard Temperaments and Tuning Properties of the Organ, Harpsichord, and Piano',
    17: 'Sound Production in Pianos',
    18: 'The Clavichord and the Harpsichord',
    19: 'The Voice as a Musical Instrument',
    20: 'The Brass Wind Instruments',
    21: 'The Woodwinds: I',
    22: 'The Woodwinds: II',
    23: 'The Oscillations of a Bowed String',
    24: 'Instruments of the Violin Family',
    25: 'Half-Valved Octaves, Burrs, Multiphonics, and Wolf Notes',
  },
  winer: {
    1: 'Audio Basics',
    2: 'Audio Fidelity, Measurements, and Myths',
    3: 'Hearing, Perception, and Artifact Audibility',
    4: 'Gozintas and Gozoutas',
    5: 'Mixers, Buses, Routing, and Summing',
    6: 'Recording Devices and Methods',
    7: 'Mixing Devices and Methods',
    8: 'Digital Audio Basics',
    9: 'Dynamics Processors',
    10: 'Frequency Processors',
    11: 'Time Domain Processors',
    12: 'Pitch and Time Manipulation Processors',
    13: 'Other Audio Processors',
    14: 'Synthesizers',
    15: 'MIDI Basics',
    16: 'Video Production',
    17: 'Microphones and Pickups',
    18: 'Loudspeakers and Earphones',
    19: 'Acoustic Basics',
    20: 'Room Shapes, Modes, and Isolation',
    21: 'Acoustic Treatment',
    22: 'Room Measuring',
    23: 'Basic Electronics in 60 Minutes',
    24: 'Test Procedures',
    25: 'Computers',
    26: 'Musical Instruments',
  },
};

export const BOOK_TITLE: Readonly<Record<Book, string>> = {
  benade: 'Benade, Fundamentals of Musical Acoustics (Dover)',
  winer: 'Winer, The Audio Expert, 2nd ed. (Routledge 2018)',
};

export type Topic = 'harmonics' | 'strings' | 'temperament' | 'resonance' | 'loudness' | 'ranges' | 'signal' | 'processing' | 'tape' | 'theory';

export const TOPICS: readonly { readonly id: Topic; readonly label: string }[] = [
  { id: 'harmonics', label: 'Harmonic series and overtones' },
  { id: 'strings', label: 'String vibration, scale length and tension' },
  { id: 'temperament', label: 'Intonation and temperament' },
  { id: 'resonance', label: 'Resonance, body and pickups' },
  { id: 'loudness', label: 'Decibels, loudness and hearing' },
  { id: 'ranges', label: 'Guitar frequency ranges' },
  { id: 'signal', label: 'Signal flow and gain staging' },
  { id: 'processing', label: 'EQ, compression and reverb' },
  { id: 'tape', label: 'Tape and noise reduction' },
  { id: 'theory', label: 'Practical guitar theory' },
];

interface Base {
  readonly id: string;
  readonly topic: Topic;
  readonly question: string;
  readonly source: Source;
}
export interface QaCard extends Base {
  readonly type: 'qa';
  readonly answer: string;
}
export interface McCard extends Base {
  readonly type: 'mc';
  readonly answer: string;
  /** Three wrong but plausible options. */
  readonly wrong: readonly [string, string, string];
  /** Shown after answering. */
  readonly why: string;
}
export type TheoryCard = QaCard | McCard;

const B = (chapter: number): Source => ({ book: 'benade', chapter });
const W = (chapter: number): Source => ({ book: 'winer', chapter });
const G = (note: string): Source => ({ book: 'general', note });

function qa(topic: Topic, id: string, question: string, answer: string, source: Source): QaCard {
  return { id, topic, type: 'qa', question, answer, source };
}
function mc(topic: Topic, id: string, question: string, answer: string, wrong: [string, string, string], why: string, source: Source): McCard {
  return { id, topic, type: 'mc', question, answer, wrong, why, source };
}

export const DECK: readonly TheoryCard[] = Object.freeze([
  // ------------------------------------------------- harmonic series (12)
  qa('harmonics', 'harm-multiples', 'The open A string vibrates at 110 Hz. What frequencies are its 2nd, 3rd and 4th harmonics?', '220, 330 and 440 Hz: each harmonic is a whole-number multiple of the fundamental.', B(5)),
  mc('harmonics', 'harm-2-3', 'Which interval lies between the 2nd and 3rd harmonics of a string?', 'A perfect fifth', ['An octave', 'A perfect fourth', 'A major third'], 'Their frequencies are in the ratio 3:2, the pure fifth.', B(14)),
  mc('harmonics', 'harm-3-4', 'Which interval lies between the 3rd and 4th harmonics?', 'A perfect fourth', ['A perfect fifth', 'A major third', 'A minor third'], 'The ratio 4:3 is a pure fourth.', B(14)),
  qa('harmonics', 'harm-4-5', 'Which interval lies between the 4th and 5th harmonics, and how does it compare with the fretted version?', 'A major third (ratio 5:4). The pure third is about 14 cents lower than the equal-tempered third the frets give.', B(14)),
  qa('harmonics', 'harm-7th', 'Why does the 7th harmonic not match any fretted note well?', 'It sits about 31 cents below the equal-tempered minor seventh, so no fret lands on it.', B(14)),
  mc('harmonics', 'harm-fret7', 'Touching an open string lightly right over the 7th fret and plucking gives which harmonic?', 'The 3rd harmonic: an octave and a fifth above the open string', ['The 2nd harmonic: one octave up', 'The 4th harmonic: two octaves up', 'The 7th harmonic'], 'The 7th fret is one third of the way along the string, so only modes with a still point there keep sounding; the lowest is the 3rd.', B(7)),
  qa('harmonics', 'harm-fret5', 'Why does the natural harmonic at the 5th fret sound two octaves above the open string?', 'The light touch at one quarter of the length forces a still point there. Only modes with a node at that spot survive, and the lowest of them is the 4th harmonic, two octaves up.', B(7)),
  qa('harmonics', 'harm-node', 'What is a node on a vibrating string?', 'A point that stays still for a particular mode of vibration. The nth mode has n − 1 nodes between the two ends.', B(6)),
  mc('harmonics', 'harm-midpoint', 'Plucking a string exactly at its midpoint weakens which harmonics?', 'The even-numbered ones', ['The odd-numbered ones', 'Only the fundamental', 'None: every harmonic is equally strong'], 'Even-numbered modes have a node at the midpoint, so a pluck there barely excites them.', B(7)),
  qa('harmonics', 'harm-bright-pluck', 'Why does picking near the bridge sound brighter than picking over the end of the fretboard?', 'A pluck close to the end of the string excites the high harmonics strongly; a pluck nearer the middle puts most of its energy into the low harmonics.', B(7)),
  mc('harmonics', 'harm-missing-fund', 'You hear partials at 200, 300 and 400 Hz and nothing at 100 Hz. What pitch do you hear?', 'About 100 Hz', ['200 Hz', '300 Hz', 'No clear pitch'], 'The ear infers the common fundamental from the spacing of the harmonics even when it is missing.', B(5)),
  qa('harmonics', 'harm-timbre', 'Apart from pitch and loudness, what mostly makes two instruments playing the same note sound different?', 'The relative strengths of their partials, and how those partials start and die away.', B(4)),

  // ------------------------------------------------------- strings (12)
  qa('strings', 'str-three', 'Which three properties of a string set its fundamental frequency?', 'Vibrating length, tension, and mass per unit length. Shorter, tighter or lighter strings sound higher.', B(7)),
  mc('strings', 'str-half', 'What happens to the pitch when you halve a string\'s vibrating length (fretting at the 12th fret)?', 'It rises an octave (frequency doubles)', ['It rises a fifth', 'It rises two octaves', 'It does not change'], 'Frequency is inversely proportional to vibrating length.', B(7)),
  mc('strings', 'str-tension-octave', 'To raise a string an octave by tension alone, the tension must be multiplied by about…', '4', ['2', '1.5', '8'], 'Frequency rises with the square root of tension, so doubling the frequency needs four times the tension.', B(7)),
  qa('strings', 'str-scale-tension', 'A 25.5-inch scale and a 24.75-inch scale, same strings, same tuning: which has more tension, and roughly how much?', 'The 25.5-inch scale, by about 6%: tension grows with the square of the length for the same pitch and string.', B(7)),
  mc('strings', 'str-wound', 'Why are the low guitar strings wound?', 'To add mass without adding much stiffness', ['To make them stronger', 'To reduce finger noise', 'To make them magnetic'], 'Extra mass lowers the pitch at a playable tension; a solid wire that heavy would be too stiff.', B(8)),
  qa('strings', 'str-inharmonic', 'What is inharmonicity in a guitar string, and what causes it?', 'The upper partials run slightly sharp of exact whole-number multiples. Bending stiffness causes it, and it is worse in thick, short, stiff strings.', B(8)),
  mc('strings', 'str-fret12', 'Where does the 12th fret sit on a correctly built guitar?', 'Halfway between the nut and the saddle', ['Two thirds of the way to the saddle', 'One third of the way to the saddle', 'Wherever the neck joins the body'], 'Half the length gives double the frequency: one octave.', B(7)),
  qa('strings', 'str-fret-spacing', 'Why do frets get closer together toward the body?', 'Every semitone shortens the remaining string by the same ratio (about 5.6%), so each step is a smaller distance as the string gets shorter.', B(7)),
  qa('strings', 'str-compensation', 'Why is the saddle set slightly farther from the nut than the exact scale length?', 'Pressing a string to a fret stretches it a little and its stiffness raises fretted pitch, so notes go sharp. Moving the saddle back (compensation) brings the 12th-fret note back in line with the octave harmonic.', B(8)),
  mc('strings', 'str-action', 'Raising the action (string height) usually does what to fretted notes?', 'Makes them go sharper', ['Makes them go flatter', 'Has no effect on pitch', 'Only affects open strings'], 'A taller action means more stretch when you press down, which raises tension.', B(7)),
  qa('strings', 'str-pitch-glide', 'Why can a hard-picked note start slightly sharp and settle down?', 'A large swing stretches the string, briefly raising its tension and pitch; as the motion dies away the pitch settles.', B(8)),
  mc('strings', 'str-gauge', 'Same scale length, same tuning, heavier gauge: what happens to the tension?', 'It goes up', ['It goes down', 'It stays the same', 'It depends only on the scale length'], 'More mass per unit length needs more tension to reach the same pitch.', B(7)),

  // --------------------------------------------------- temperament (11)
  qa('temperament', 'temp-semitone', 'In 12-tone equal temperament, what is the frequency ratio between neighbouring semitones?', 'The twelfth root of 2, about 1.0595. Each semitone is 100 cents.', B(16)),
  mc('temperament', 'temp-cents', 'How many cents make an octave?', '1200', ['100', '700', '1000'], 'Twelve equal semitones of 100 cents each.', B(16)),
  qa('temperament', 'temp-third', 'How does an equal-tempered major third compare with a pure 5:4 third?', 'It is about 14 cents sharp (400 cents against about 386).', B(16)),
  mc('temperament', 'temp-fifth', 'How does an equal-tempered fifth compare with a pure 3:2 fifth?', 'About 2 cents flat', ['About 14 cents sharp', 'Exactly the same', 'About 20 cents flat'], '700 cents against about 702: a very small compromise.', B(16)),
  qa('temperament', 'temp-why-compromise', 'Why can no fixed tuning make every chord on a guitar perfectly pure?', 'Pure fifths and pure thirds do not stack up to whole octaves; there is always a small leftover (a comma). Frets fix equal steps, which spread that error evenly instead of making some keys perfect and others bad.', B(16)),
  qa('temperament', 'temp-pyth-comma', 'What is the Pythagorean comma?', 'The overshoot of twelve pure fifths beyond seven octaves: about 23.5 cents.', B(16)),
  mc('temperament', 'temp-syntonic', 'Four pure fifths up (minus two octaves) land how far from a pure major third?', 'About 21.5 cents sharp (the syntonic comma)', ['Exactly on it', 'About 2 cents flat', 'A full semitone sharp'], 'This gap is why tuning by fifths alone gives wide, rough thirds.', B(15)),
  qa('temperament', 'temp-harmonic-tuning', 'Why can tuning a guitar only with 5th- and 7th-fret harmonics leave it slightly out?', 'Those harmonics give pure fourths and fifths, about 2 cents off the equal-tempered intervals the frets use, and the small errors add up from string to string.', B(14)),
  mc('temperament', 'temp-beats', 'Two tones at 440 Hz and 443 Hz sound together. How many beats per second?', '3', ['443', '1.5', '6'], 'The beat rate equals the difference between the two frequencies.', B(14)),
  qa('temperament', 'temp-just', 'What is just intonation?', 'Tuning intervals to simple whole-number ratios from the harmonic series (3:2, 5:4 and so on). Chords in one key are beat-free, but other keys go badly out.', B(15)),
  mc('temperament', 'temp-press', 'Which fretting habit pulls notes sharp?', 'Pressing too hard or pushing the string sideways', ['Fretting right behind the fret', 'Using lighter pressure', 'Playing with a capo'], 'Extra pressure or sideways push stretches the string and raises its tension.', B(7)),

  // ---------------------------------------------------- resonance (12)
  qa('resonance', 'res-define', 'What is resonance?', 'A large response when something is driven at or near one of its own natural frequencies.', B(10)),
  mc('resonance', 'res-soundboard', 'Why is an acoustic guitar so much louder than a string on its own?', 'The bridge passes the string\'s motion to the large top, which moves a lot of air', ['The soundhole amplifies the string', 'The neck vibrates like a speaker', 'The strings are under more tension'], 'A thin string barely moves the air; the soundboard is a far better radiator.', B(9)),
  qa('resonance', 'res-air', 'What does the air inside an acoustic guitar body do?', 'With the soundhole it forms a resonator (like blowing across a bottle) that reinforces the low end near its own resonant frequency.', B(10)),
  mc('resonance', 'res-wolf', 'A note that dies quickly or warbles while its neighbours ring is usually caused by…', 'A strong body or neck resonance taking energy from the string at that pitch', ['A worn fret', 'Old strings', 'The pickup height'], 'When a structural resonance matches the note, the string\'s energy drains away fast or beats against it (a wolf note).', B(25)),
  qa('resonance', 'res-sustain', 'Why do notes on a solid-body guitar usually sustain longer than on an acoustic?', 'The heavy, stiff body takes much less energy from the string, so the string loses energy more slowly. An acoustic spends that energy on being loud.', B(4)),
  qa('resonance', 'res-pickup', 'How does a magnetic pickup make a signal?', 'The steel string moving in the magnet\'s field changes the magnetic flux through the coil, and that change induces a voltage. Faster string motion gives more voltage.', W(17)),
  mc('resonance', 'res-humbucker', 'Why does a humbucker hum less than a single coil?', 'Its two coils are wired so outside hum cancels while the string signal adds', ['It has a stronger magnet', 'It sits farther from the strings', 'Its cover blocks electrical noise'], 'The coils are wound and magnetized in opposite senses: hum arrives in both equally and cancels; the string signal does not.', W(17)),
  qa('resonance', 'res-neck-bridge', 'Why does a neck pickup sound warmer than a bridge pickup?', 'Near the middle of the string the low harmonics swing widely; near the bridge the string moves little except in the higher harmonics, so the bridge pickup hears relatively more treble.', W(17)),
  mc('resonance', 'res-cable', 'Why can a long guitar cable make a passive guitar sound duller?', 'Cable capacitance lowers the pickup\'s resonant peak', ['Long cables add bass', 'The signal travels too slowly', 'Long cables add hum only'], 'Pickup inductance and cable capacitance form a resonance a few kHz up; more capacitance moves it lower and rolls off highs.', W(17)),
  qa('resonance', 'res-piezo', 'Why do piezo pickups usually need a preamp or a very high-impedance input?', 'A piezo element is a very high-impedance source that behaves like a small capacitor. A normal input loads it down and loses the bass.', W(17)),
  mc('resonance', 'res-out-of-phase', 'Two pickups combined out of phase sound…', 'Thin and nasal', ['Louder and fuller', 'Exactly like one pickup', 'Distorted'], 'The low frequencies, which both pickups hear nearly the same, cancel; differences in the highs remain.', W(17)),
  qa('resonance', 'res-decay-color', 'Why does a ringing guitar note get darker as it fades?', 'The higher partials lose their energy faster than the lower ones, so the spectrum tilts toward the fundamental over time.', B(4)),

  // ------------------------------------------------------ loudness (12)
  mc('loudness', 'db-voltage', 'Doubling a signal\'s voltage raises its level by about…', '6 dB', ['3 dB', '10 dB', '2 dB'], 'Level in dB for voltage is 20 × log10 of the ratio; 20 × log10(2) ≈ 6.', W(1)),
  mc('loudness', 'db-power', 'Doubling the power raises the level by about…', '3 dB', ['6 dB', '10 dB', '1 dB'], 'For power it is 10 × log10 of the ratio; 10 × log10(2) ≈ 3.', W(1)),
  qa('loudness', 'db-twice', 'Roughly how many dB louder must a sound be to seem twice as loud?', 'About 10 dB.', B(13)),
  qa('loudness', 'db-dbu', 'What are the references for dBu and dBV?', '0 dBu is 0.775 volts RMS; 0 dBV is 1 volt RMS.', W(1)),
  mc('loudness', 'db-pro-consumer', 'Pro line level is +4 dBu and consumer level is −10 dBV. How far apart are they?', 'About 12 dB', ['14 dB', '6 dB', '4 dB'], '+4 dBu is about 1.23 V and −10 dBV about 0.32 V: a ratio near 3.9, or 11.8 dB.', W(1)),
  qa('loudness', 'db-quiet-thin', 'Why does a mix played quietly sound thinner than the same mix played loud?', 'The ear is less sensitive to low (and very high) frequencies at low levels, so bass seems to drop away when the volume goes down.', W(3)),
  mc('loudness', 'db-sensitive', 'Human hearing is most sensitive around…', '2 to 5 kHz', ['50 to 100 Hz', '200 to 500 Hz', '12 to 16 kHz'], 'Ear-canal resonance helps put peak sensitivity in this range.', W(3)),
  mc('loudness', 'db-correlated', 'Two identical signals, perfectly in phase, are added. The level rises by…', '6 dB', ['3 dB', '0 dB', '12 dB'], 'Identical voltages add directly (double), which is +6 dB. Two unrelated sources of equal level add only about 3 dB.', W(5)),
  qa('loudness', 'db-masking', 'What is masking?', 'A loud sound making quieter sounds near its frequency hard or impossible to hear. It reaches further above the masking frequency than below it.', W(3)),
  qa('loudness', 'db-exposure', 'What exposure limit does NIOSH recommend to protect hearing?', '85 dBA for 8 hours; every 3 dB louder halves the safe time (88 dBA for 4 hours, 91 for 2, and so on).', G('NIOSH occupational noise guideline; not from Benade or Winer')),
  mc('loudness', 'db-distance', 'In open space, doubling your distance from a small source lowers its level by about…', '6 dB', ['3 dB', '10 dB', '1 dB'], 'Sound spreads over four times the area at twice the distance: the inverse square law.', W(19)),
  qa('loudness', 'db-spl-zero', 'What does 0 dB SPL mean?', 'A sound pressure of 20 micropascals, roughly the quietest 1 kHz tone a young healthy ear can hear.', W(1)),

  // -------------------------------------------------------- ranges (10)
  mc('ranges', 'rng-low-e', 'What is the fundamental of the low E string in standard tuning?', 'About 82 Hz', ['About 41 Hz', 'About 110 Hz', 'About 165 Hz'], 'E2 is 82.4 Hz.', W(26)),
  qa('ranges', 'rng-high-e', 'What is the fundamental of the open high E string?', 'About 330 Hz (E4, 329.6 Hz), two octaves above the low E.', W(26)),
  mc('ranges', 'rng-a', 'What is the fundamental of the open A string?', '110 Hz', ['55 Hz', '220 Hz', '440 Hz'], 'A2 is exactly 110 Hz when A4 is tuned to 440.', W(26)),
  qa('ranges', 'rng-top', 'What is the highest fundamental on the high E string of a 22-fret guitar?', 'D6, about 1175 Hz. The harmonics above it carry the sound much higher.', W(26)),
  qa('ranges', 'rng-presence', 'Which range is often called guitar presence, and why does it matter?', 'Roughly 2 to 5 kHz: pick attack and articulation live there, and the ear is very sensitive to it.', W(10)),
  mc('ranges', 'rng-speaker', 'A typical 12-inch guitar speaker rolls off steeply above about…', '5 kHz', ['500 Hz', '15 kHz', '20 kHz'], 'That roll-off is part of the sound of an electric guitar through an amp.', W(26)),
  qa('ranges', 'rng-highpass', 'Why is a high-pass filter around 80 to 100 Hz common on guitar tracks?', 'The guitar has almost no useful fundamental below its low E (82 Hz). Filtering below removes rumble and leaves room for bass and kick.', W(10)),
  mc('ranges', 'rng-bass', 'What is the fundamental of a bass guitar\'s low E?', 'About 41 Hz', ['About 82 Hz', 'About 30 Hz', 'About 55 Hz'], 'E1 is 41.2 Hz, one octave below the guitar\'s low E.', W(26)),
  qa('ranges', 'rng-drop-d', 'What is the fundamental of the low string in drop D?', 'About 73 Hz (D2, 73.4 Hz).', W(26)),
  mc('ranges', 'rng-mud', 'Guitar muddiness in a mix is most often around…', '200 to 500 Hz', ['20 to 50 Hz', '2 to 5 kHz', '10 to 15 kHz'], 'Low-mid build-up from several instruments clouds the mix; listen there first.', W(10)),

  // -------------------------------------------------------- signal (11)
  qa('signal', 'sig-gain-staging', 'What is gain staging?', 'Setting the level at every stage of the chain so the signal stays well above the noise and well below clipping all the way through.', W(5)),
  mc('signal', 'sig-first-stage', 'Where should most of the gain come from for the lowest noise?', 'The first stage (the preamp)', ['The master fader', 'The last effect in the chain', 'The monitor volume'], 'Noise added later is not amplified by earlier gain; a healthy level early keeps every later stage\'s noise small by comparison.', W(5)),
  qa('signal', 'sig-headroom', 'What is headroom?', 'The space between the normal operating level and the point where the system clips.', W(1)),
  mc('signal', 'sig-hi-z', 'A passive guitar plugged straight into a low-impedance line input usually sounds…', 'Dull and weak', ['Brighter and louder', 'Exactly the same', 'Distorted only'], 'The low input impedance loads the pickup; guitar inputs are about 1 megohm for this reason.', W(4)),
  qa('signal', 'sig-di', 'What does a DI box do?', 'It turns a high-impedance, unbalanced instrument signal into a low-impedance, balanced, mic-level signal for long cables and mic inputs, often with a ground-lift switch.', W(4)),
  mc('signal', 'sig-balanced', 'Why do balanced lines reject noise?', 'Noise picked up equally on both conductors cancels at the differential input', ['The shield absorbs all noise', 'The signal is louder', 'They are shorter'], 'This is common-mode rejection: only the difference between the two wires is amplified.', W(4)),
  qa('signal', 'sig-insert-aux', 'Insert or aux send: which for a compressor on one track, which for a shared reverb?', 'Insert for the compressor (it sits in series in that one channel); aux send for the reverb (several channels feed it, and its output is blended back).', W(5)),
  mc('signal', 'sig-pre-post', 'Which aux setting suits a headphone mix for a player?', 'Pre-fader', ['Post-fader', 'Insert', 'Direct out after the EQ only'], 'Pre-fader sends ignore the mix fader, so mix moves do not change the player\'s headphones. Effects sends are usually post-fader.', W(5)),
  qa('signal', 'sig-snr', 'What is signal-to-noise ratio?', 'The level difference, in dB, between a normal signal and the background noise of the system.', W(2)),
  mc('signal', 'sig-ground-loop', 'A steady hum at 60 Hz (50 Hz in Europe) and its harmonics often points to…', 'A ground loop', ['A dead battery', 'Too much treble', 'A loose speaker cone'], 'Two paths to ground form a loop that picks up mains hum; a DI ground lift or balanced lines often fix it.', W(4)),
  qa('signal', 'sig-digital-headroom', 'Why is there no need to record peaks near 0 dBFS at 24 bits?', 'Twenty-four bits leave so much dynamic range that peaks 10 to 20 dB below full scale are still far above the noise, and clipping is avoided.', W(8)),

  // ---------------------------------------------------- processing (13)
  mc('processing', 'eq-highpass', 'What does a high-pass filter do?', 'Lets frequencies above its cutoff through and cuts those below', ['Boosts the highs', 'Cuts the highs', 'Removes one narrow frequency'], 'High-pass means the highs pass; it is a low cut.', W(10)),
  qa('processing', 'eq-q', 'What does the Q control on a parametric EQ set?', 'How wide the boosted or cut band is: higher Q means a narrower band.', W(10)),
  mc('processing', 'eq-shelf', 'A shelving EQ…', 'Boosts or cuts everything beyond its corner frequency by the same amount', ['Affects only one narrow band', 'Removes everything below the corner', 'Changes the pitch'], 'The response looks like a shelf: flat, a slope, then flat again at the new level.', W(10)),
  qa('processing', 'eq-notch', 'What is a notch filter for?', 'A very narrow, deep cut that removes one frequency, such as a hum or a single ringing resonance, while leaving the rest alone.', W(10)),
  mc('processing', 'comp-ratio', 'A compressor at 4:1. The input goes 8 dB over the threshold. How far over is the output?', '2 dB', ['4 dB', '8 dB', '32 dB'], 'At 4:1, every 4 dB in above the threshold comes out as 1 dB.', W(9)),
  qa('processing', 'comp-threshold', 'What is a compressor\'s threshold?', 'The level above which it starts turning the signal down.', W(9)),
  mc('processing', 'comp-attack', 'A slow attack (say 30 ms) on a guitar compressor tends to…', 'Let the pick attack through, so the sound stays punchy', ['Remove the pick attack entirely', 'Add reverb', 'Raise the noise floor only'], 'The compressor reacts after the transient has passed.', W(9)),
  qa('processing', 'comp-release', 'What does release time do, and what goes wrong at the extremes?', 'It sets how fast the gain comes back once the level drops. Too fast can pump or distort low notes; too slow keeps the sound squashed.', W(9)),
  mc('processing', 'comp-limiter', 'What makes a limiter different from a compressor?', 'A very high ratio (10:1 or more), so peaks are held at the threshold', ['It only works on bass', 'It adds gain instead', 'It has no threshold'], 'A limiter is a compressor set to stop peaks, not shape dynamics gently.', W(9)),
  qa('processing', 'comp-makeup', 'What is make-up gain?', 'Gain added after compression to bring the overall level back up after the compressor has turned the peaks down.', W(9)),
  qa('processing', 'rev-rt60', 'What is RT60?', 'The time it takes sound in a room (or a reverb) to die away by 60 dB after the source stops.', W(19)),
  mc('processing', 'rev-predelay', 'What does pre-delay on a reverb do?', 'Leaves a short gap before the reverb starts, keeping the dry sound clear', ['Makes the reverb longer', 'Removes low end from the reverb', 'Adds echo repeats'], 'Separating the direct sound from the reverb onset helps clarity.', W(11)),
  qa('processing', 'rev-early', 'Why do early reflections matter to how a guitar sounds in a room?', 'Reflections arriving within a few tens of milliseconds fuse with the direct sound: they colour its tone and size without being heard as echoes. Later sound is heard as reverberation.', B(12)),

  // ---------------------------------------------------------- tape (12)
  qa('tape', 'tape-hiss', 'Why does cassette hiss more than wide, fast open-reel tape?', 'Its tracks are narrow and the tape moves slowly, so less tape carries the signal each second and the signal sits closer to the tape\'s noise.', W(6)),
  mc('tape', 'tape-xlii-type', 'Maxell XLII is which kind of cassette?', 'Type II (high bias, 70 µs EQ)', ['Type I (normal bias)', 'Type IV (metal)', 'Type III (ferrichrome)'], 'XLII is a high-bias Type II tape.', G('Maxell product specification; not from Benade or Winer')),
  qa('tape', 'tape-type2-settings', 'How should a deck be set for Type II tape like XLII?', 'High bias and 70 µs playback EQ. Many decks switch automatically from the extra notches in a Type II shell; on a machine with a switch, set it to High or CrO2.', G('Cassette type standards; not from Benade or Winer')),
  qa('tape', 'tape-dbx-how', 'How does dbx noise reduction work?', 'It compresses the signal 2:1 (in dB) with treble emphasis when recording and expands it 1:2 on playback. Quiet parts go to tape hotter, so the hiss is pushed down when they are restored.', W(6)),
  mc('tape', 'tape-dbx-undecoded', 'A dbx-encoded tape played back without dbx sounds…', 'Squashed and too bright', ['Exactly the same', 'Dull and quiet', 'Slower'], 'You hear the record-side compression and treble boost without the playback side undoing them.', W(6)),
  qa('tape', 'tape-dbx-cal', 'Does dbx need level calibration the way Dolby B or C does?', 'No. dbx compresses evenly in dB across its whole range, so it tracks without a matched reference level; Dolby relies on matched levels.', G('dbx and Dolby system behaviour; not from Benade or Winer')),
  mc('tape', 'tape-breathing', 'Hiss that rises and falls behind a sparse part (a lone bass note, a quiet guitar) on a dbx tape is called…', 'Breathing (noise modulation)', ['Wow', 'Flutter', 'Print-through'], 'The expander follows the signal, so the hiss under it comes and goes.', W(6)),
  qa('tape', 'tape-one-side', 'Why does a 4-track cassette recorder use only one side of the tape?', 'It records all four tracks in one direction across the full tape width that a stereo deck splits into two sides, so there is no second side to flip to.', G('Cassette multitrack format; not from Benade or Winer')),
  qa('tape', 'tape-bounce', 'What is bouncing on a 4-track, and what does it cost?', 'Mixing several tracks onto a free track to make room for more parts. Each bounce adds another generation of noise and some loss, and the bounced parts can no longer be rebalanced.', W(6)),
  mc('tape', 'tape-type2-vs-1', 'Compared with Type I tape, Type II tape such as XLII usually gives…', 'Less hiss and more high-frequency headroom', ['More hiss but better bass', 'Exactly the same sound', 'Longer recording time only'], 'The 70 µs playback EQ lowers hiss, and the formulation handles strong highs better.', G('Cassette type standards; not from Benade or Winer')),
  qa('tape', 'tape-heads', 'Why clean and demagnetize tape heads?', 'Oxide build-up dulls the highs and causes dropouts; a magnetized head adds hiss and can partly erase high frequencies from tapes it plays.', W(6)),
  qa('tape', 'tape-azimuth', 'What is azimuth, and what does misalignment do?', 'The angle of the head gap to the tape. If it is off, high frequencies are lost, especially on tapes recorded on another machine.', W(6)),

  // -------------------------------------------------------- theory (15)
  mc('theory', 'th-major', 'What are the chord tones of a major triad?', '1, 3, 5', ['1, ♭3, 5', '1, 3, ♯5', '1, 4, 5'], 'Root, major third (4 semitones) and perfect fifth (7 semitones).', G('Standard music theory; not from Benade or Winer')),
  mc('theory', 'th-minor', 'What are the chord tones of a minor triad?', '1, ♭3, 5', ['1, 3, 5', '1, ♭3, ♭5', '1, 2, 5'], 'Root, minor third (3 semitones) and perfect fifth.', G('Standard music theory; not from Benade or Winer')),
  qa('theory', 'th-dom7', 'What are the chord tones of a dominant 7 chord, and what are they for G7?', '1, 3, 5, ♭7. G7 is G, B, D, F.', G('Standard music theory; not from Benade or Winer')),
  qa('theory', 'th-maj7', 'What is the difference between Cmaj7 and C7?', 'Cmaj7 has a major seventh (B, 11 semitones up); C7 has a minor seventh (B♭, 10 semitones up).', G('Standard music theory; not from Benade or Winer')),
  mc('theory', 'th-c-to-g', 'What interval is C up to G?', 'A perfect fifth', ['A perfect fourth', 'A major sixth', 'A major third'], 'Seven semitones: C, D, E, F, G spans five letter names.', B(14)),
  qa('theory', 'th-inversion', 'What does a major third become when you invert it (move the lower note up an octave)?', 'A minor sixth. Inverted intervals add up to nine in number, and major becomes minor.', G('Standard music theory; not from Benade or Winer')),
  mc('theory', 'th-dim', 'What are the chord tones of a diminished triad?', '1, ♭3, ♭5', ['1, 3, ♭5', '1, ♭3, 5', '1, 3, ♯5'], 'Two stacked minor thirds.', G('Standard music theory; not from Benade or Winer')),
  qa('theory', 'th-caged', 'What is the CAGED system?', 'A way to map the neck: the five open chord shapes C, A, G, E and D, moved up the neck as barre shapes, connect in that order to cover the fretboard for any major chord.', G('Guitar teaching system; not from Benade or Winer')),
  mc('theory', 'th-e-shape-3', 'An E-shape barre chord at the 3rd fret is which chord?', 'G major', ['A major', 'C major', 'F major'], 'The root is on the 6th string, and the 6th string at fret 3 is G.', G('Guitar teaching system; not from Benade or Winer')),
  qa('theory', 'th-a-shape-5', 'An A-shape barre with its root at the 5th fret of the A string is which chord?', 'D major: the A string at fret 5 is D.', G('Guitar teaching system; not from Benade or Winer')),
  mc('theory', 'th-caged-next', 'Going up the neck in CAGED order, which shape comes after the E shape?', 'The D shape', ['The C shape', 'The A shape', 'The G shape'], 'The order cycles C, A, G, E, D, then C again an octave up.', G('Guitar teaching system; not from Benade or Winer')),
  qa('theory', 'th-dorian', 'How is the Dorian mode built, and which white-key scale is it?', 'A natural minor scale with a raised 6th. On white keys, D to D.', B(15)),
  mc('theory', 'th-mixolydian', 'The Mixolydian mode is…', 'A major scale with a ♭7', ['A major scale with a ♯4', 'A minor scale with a raised 6th', 'A minor scale with a ♭2'], 'On white keys, G to G. It suits dominant 7 chords.', B(15)),
  qa('theory', 'th-lydian', 'How is the Lydian mode built?', 'A major scale with a raised (♯) 4th. On white keys, F to F.', B(15)),
  mc('theory', 'th-relative', 'What is the relative minor of G major?', 'E minor', ['G minor', 'A minor', 'B minor'], 'The relative minor starts on the 6th degree and shares the key signature (one sharp).', G('Standard music theory; not from Benade or Winer')),
]);

/** The citation shown on a card. */
export function citation(source: Source): string {
  if (source.book === 'general') return `Source: ${source.note}`;
  return `Source: ${BOOK_TITLE[source.book]}, ch. ${source.chapter}, ${CHAPTERS[source.book][source.chapter]}`;
}

export const cardById = (id: string) => DECK.find((c) => c.id === id);
