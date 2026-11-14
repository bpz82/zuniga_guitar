/**
 * Chapter 7: Microphones, pickups and levels. First third of the old
 * chapter 5 (split 2026-11-13 so the chapter horizon paces). The dBu/dBV
 * arithmetic moves to the Extras; its slot goes to setting an interface.
 */
import { keep, lesson, LIVE_SRC, mc, qa, W } from '../course-kit.ts';
import type { LessonSpec } from '../course-kit.ts';

export const CH7: readonly LessonSpec[] = [
  lesson('l18', 7, 'Microphones', [
    'A transducer turns one kind of energy into another. Microphones and guitar pickups turn vibration into an electrical signal; speakers do the reverse.',
    'A dynamic microphone has a diaphragm fixed to a coil of wire that sits in a magnet\'s field; moving the coil makes a voltage. It is rugged, handles very loud sound and needs no power. A condenser microphone uses a very light diaphragm as one plate of a capacitor (two plates holding an electric charge); it catches fine detail and quiet sounds, and needs power, usually 48-volt phantom power sent along the microphone cable.',
    'A microphone\'s polar pattern shows how well it hears from each direction. Omni hears all round. Cardioid (heart-shaped) favours the front and rejects the back. Figure-8 hears front and back equally and rejects the sides. Directional microphones add bass when very close to the source: the proximity effect.',
  ], [
    qa('transducer', 'What is a transducer? Give two guitar-related examples.', 'A device that turns one kind of energy into another: a microphone or pickup (vibration to electricity), a speaker (electricity to sound).', W(17)),
    mc('dynamic-condenser', 'How does a condenser microphone differ from a dynamic one?', 'Its very light diaphragm is a capacitor plate: more detail, but it needs power', ['Its diaphragm drives a coil in a magnet, so it needs no power at all', 'It is built for very loud sources and rejects fine detail on purpose', 'It hears only from the sides, so it suits drums and amps best'], 'Dynamic: coil and magnet, rugged, no power. Condenser: capacitor, detailed, powered.', W(17)),
    mc('phantom', 'Which kind of microphone normally needs phantom power?', 'Condenser', ['Dynamic', 'Ribbon', 'A magnetic guitar pickup'], 'The capacitor needs a charge, and many condensers have built-in electronics too.', W(17)),
    mc('cardioid', 'A cardioid microphone mainly rejects sound from…', 'Behind it', ['In front of it', 'Only the sides', 'Nowhere: it hears all round'], 'Its heart-shaped pattern favours the front.', W(17)),
    mc('figure-8', 'A figure-8 microphone rejects sound from…', 'The sides', ['The back', 'The front', 'Nowhere: it hears all round'], 'It hears front and back equally.', W(17)),
    qa('omni', 'What does an omni microphone pick up?', 'Sound from every direction about equally.', W(17)),
    qa('proximity', 'What is the proximity effect?', 'The extra bass a directional microphone gives when it is very close to the source.', W(17)),
  ]),
  lesson('l18', 7, 'Guitar pickups', [
    'A magnetic guitar pickup is a magnet wrapped in thousands of turns of thin wire. The steel string moving through its field changes the magnetism through the coil, and that change makes a voltage. A single coil also picks up hum from mains wiring, lights and transformers. A humbucker uses two coils wired so that hum from outside cancels while the string\'s signal adds.',
    'A pickup hears the string only where it sits. Near the bridge the string moves little except in its higher modes, so a bridge pickup sounds brighter and thinner; nearer the neck the low modes swing widely, so a neck pickup sounds warmer. That is why a Strat\'s three pickups sound so different from one another.',
    'Two pickups wired out of phase cancel what they hear alike, mostly the low frequencies, leaving a thin, nasal sound. A piezo pickup (on most acoustic-electrics) is a crystal under the saddle that makes a voltage when squeezed; it behaves like a tiny capacitor with a very high impedance, so it needs a preamp or a very high-impedance input to keep its bass.',
  ], [
    qa('pickup', 'How does a magnetic pickup make a signal?', 'The steel string moving in the magnet\'s field changes the magnetism through the coil, and that change makes a voltage.', W(17)),
    mc('humbucker', 'Why does a humbucker hum less than a single-coil pickup?', 'Its two coils are wired so outside hum cancels while the string\'s signal adds', ['It has a stronger magnet that drowns the hum out', 'It sits farther from the strings, away from the hum', 'Its metal cover blocks all outside electrical noise'], 'Hum reaches both coils equally and cancels; the string signal does not.', W(17)),
    mc('single-coil-hum', 'A single-coil guitar hums louder when you face a dimmer or a computer screen. Why?', 'Its coil picks up their electrical field as well as the strings', ['The strings vibrate in sympathy with the screen', 'The light makes the magnet weaker', 'The screen plays sound the pickup hears'], 'Turning a few degrees away often changes the hum; a humbucker cancels it.', W(17)),
    mc('neck-bridge', 'On a Strat, why does the bridge pickup sound thinner than the neck pickup?', 'At the bridge the string moves mostly in its higher modes; near the neck the low modes swing widely', ['The bridge pickup has fewer turns of wire, so it makes a weaker, thinner signal', 'The bridge pickup sits farther from the amp, so its bass is lost on the way', 'The neck soaks up the low end before the bridge pickup can hear it'], 'A pickup hears the string\'s motion only at its own position.', W(26)),
    keep('res-out-of-phase', mc('', 'Two pickups combined out of phase sound…', 'Thin and nasal', ['Louder and fuller', 'Exactly like one pickup', 'Distorted'], 'The low frequencies, which both pickups hear nearly the same, cancel; differences in the highs remain.', W(17))),
    keep('res-piezo', qa('', 'Why do piezo pickups usually need a preamp or a very high-impedance input?', 'A piezo element is a very high-impedance source that behaves like a small capacitor. A normal input loads it down and loses the bass.', W(17))),
  ]),
  lesson('l19', 7, 'Signal levels and gain staging', [
    'Audio signals come at very different strengths. Mic level is tiny (thousandths of a volt) and needs the most gain. Instrument level, from a passive guitar (one with no battery-powered electronics), is stronger but delicate. Line level is the strong signal that mixers, interfaces and effects pass to each other. Voltage follows the same rule as pressure: double it and the level rises 6 dB. (Professional gear runs at about +4 dBu and home gear at about −10 dBV, two reference scales about 12 dB apart: 0 dBu is 0.775 volts, 0 dBV 1 volt.)',
    'A passive pickup loses treble and level when it feeds a low-impedance input, which is why guitar inputs are about 1 megohm. On a recording interface, plug the guitar into the input marked Instrument or Hi-Z, then set the gain so your hardest playing never lights the clip light.',
    'Mixer words: a channel is one input\'s strip of controls; its fader sets its level in the mix; a bus is a path where several channels are added together, such as the main mix or an aux; a track is one recorded part.',
    'The noise floor is the level of a system\'s background hiss. Signal-to-noise ratio is the gap, in dB, between a normal signal and that noise floor. Gain staging means setting the level at each step so the signal stays well above the noise and well below clipping, getting most of the gain at the first stage, the preamp, because noise added later is not raised by it.',
  ], [
    mc('three-levels', 'From weakest to strongest, which order is right?', 'Mic level, instrument level, line level', ['Line, mic, instrument', 'Instrument, mic, line', 'Mic, line, instrument'], 'Mic level needs the most gain; line level is what gear passes between itself.', W(4)),
    mc('hi-z', 'A passive guitar plugged straight into a low-impedance line input usually sounds…', 'Dull and weak', ['Brighter and louder', 'Exactly the same', 'Distorted only'], 'The low input impedance loads the pickup; guitar inputs are about 1 megohm for this reason.', W(4)),
    mc('interface-input', 'Recording a passive guitar straight into an interface, which input should you use?', 'The one marked Instrument or Hi-Z', ['A line input, for the strongest signal', 'A microphone input with phantom power on', 'The headphone output, turned up'], 'A Hi-Z input is about 1 megohm, so it does not load the pickup.', W(4)),
    mc('interface-gain', 'How should you set an interface\'s input gain for guitar?', 'So your hardest playing never lights the clip light, with room to spare', ['As high as it goes, so the signal is far above the noise', 'So the clip light flashes on the loudest notes', 'At its lowest, and raise the level later in the mix'], 'Clipping cannot be undone; a little lower costs almost nothing.', LIVE_SRC),
    qa('mixer-words', 'On a mixer, what are a channel and a bus?', 'A channel is one input\'s strip of controls; a bus is a path where several channels are added together, such as the main mix or an aux mix.', W(5)),
    qa('noise-floor', 'What is the noise floor?', 'The level of a system\'s background hiss: the quietest sound that is not buried in noise.', W(2)),
    keep('sig-snr', qa('', 'What is signal-to-noise ratio?', 'The level difference, in dB, between a normal signal and the background noise of the system.', W(2))),
    keep('sig-gain-staging', qa('', 'What is gain staging?', 'Setting the level at every stage of the chain so the signal stays well above the noise and well below clipping all the way through.', W(5))),
    mc('first-stage', 'For the lowest noise, where should most of the gain come from?', 'The first stage (the preamp)', ['The master fader', 'The last effect in the chain', 'The monitor volume'], 'Noise added later is not raised by the earlier gain, so a healthy level early keeps it small by comparison.', W(5)),
  ], [
    mc('pro-home', 'Professional line level (+4 dBu) and home line level (−10 dBV) are about how far apart?', 'About 12 dB', ['About 14 dB', 'About 6 dB', 'About 4 dB'], '+4 dBu is about 1.23 V and −10 dBV about 0.32 V: a ratio near 3.9, or about 12 dB.', W(1)),
    keep('db-dbu', qa('', 'What are the references for dBu and dBV?', '0 dBu is 0.775 volts RMS; 0 dBV is 1 volt RMS.', W(1))),
  ]),
];

