/**
 * Chapter 4: Music theory for guitarists (new, 2026-11-13). The topic deck's
 * theory cards (the old Extras, and the retired Dorian, Mixolydian and Lydian
 * cards) come back here under their old ids, now with readings, so "Read in
 * Chapter" works for them and nothing assumes prior knowledge.
 */
import { B, GUITAR_SRC, keep, lesson, mc, qa, THEORY_SRC } from '../course-kit.ts';
import type { LessonSpec } from '../course-kit.ts';

export const CH4: readonly LessonSpec[] = [
  lesson('mus1', 4, 'The major scale and keys', [
    'A scale is a set of notes in order within an octave. The major scale is built from whole steps (W: 2 semitones, 2 frets) and half steps (H: 1 semitone, 1 fret) in the pattern W W H W W W H. From C it uses only the natural notes: C D E F G A B C. Its notes are numbered 1 to 7, the scale degrees.',
    'The natural notes are A B C D E F G. Between most neighbours sits one more note, named as a sharp (♯, a semitone up) of the lower or a flat (♭, a semitone down) of the upper, except between E and F and between B and C, which are only a half step apart. C♯ and D♭ are the same pitch with two names (enharmonic); the key decides which name is written.',
    'A key is the scale a song is built from, named after its home note, the tonic. There are 12 major keys. The key signature lists the sharps or flats the scale needs: G major has one sharp (F♯), D two (F♯, C♯), A three, E four; F major has one flat (B♭), B♭ two, E♭ three.',
    'Every major key has a relative minor that shares its notes and key signature, starting on its 6th degree: A minor for C major, E minor for G major. That natural minor scale runs W H W W H W W.',
  ], [
    mc('major-steps', 'Which step pattern builds a major scale?', 'W W H W W W H', ['W H W W H W W', 'W W W H W W H', 'H W W W H W W'], 'From C it gives C D E F G A B C with no sharps or flats.', THEORY_SRC),
    qa('half-steps', 'Which natural notes are only a half step apart, with no sharp or flat between them?', 'E and F, and B and C.', THEORY_SRC),
    qa('enharmonic', 'Why can the same fret be called C♯ or D♭?', 'They are the same pitch with two names (enharmonic); the key decides which name is written.', THEORY_SRC),
    qa('tonic', 'What is a key\'s tonic?', 'Its home note: the first note of its scale, which the key is named after.', THEORY_SRC),
    mc('g-signature', 'How many sharps does G major have, and which?', 'One: F♯', ['One: C♯', 'Two: F♯ and C♯', 'None'], 'G A B C D E F♯ G: the W W H W W W H pattern needs F♯.', THEORY_SRC),
    mc('d-scale', 'Which notes make the D major scale?', 'D E F♯ G A B C♯', ['D E F G A B C', 'D E F♯ G A B C', 'D E♭ F G A B♭ C'], 'Two sharps, F♯ and C♯.', THEORY_SRC),
    keep('th-relative', mc('', 'What is the relative minor of G major?', 'E minor', ['G minor', 'A minor', 'B minor'], 'The relative minor starts on the 6th degree and shares the key signature (one sharp).', THEORY_SRC)),
    mc('relative-of-a', 'A minor is the relative minor of which major key?', 'C major', ['A major', 'E major', 'F major'], 'Same notes, no sharps or flats; A is the 6th degree of C major.', THEORY_SRC),
  ]),
  lesson('mus2', 4, 'Chords from the scale', [
    'A chord is three or more notes played together. A triad stacks two thirds on a root. Major: root, major third (4 semitones) and perfect fifth (7): 1 3 5. Minor: 1 ♭3 5, the third a semitone lower (3 semitones). Diminished: 1 ♭3 ♭5, two minor thirds. A power chord is just 1 and 5.',
    'Build a triad on each degree of the major scale, using only the scale\'s notes, and you get the diatonic chords of the key: major on 1, 4 and 5; minor on 2, 3 and 6; diminished on 7. Written in Roman numerals: I ii iii IV V vi vii° (upper case major, lower case minor). In G: G Am Bm C D Em F♯dim.',
    'The Nashville number system writes chords as numbers of the key, so one chart works in any key: 1 4 5 is G C D in G, and E A B in E. A minor chord gets a minus or m: 6- in G is Em.',
    'The 12-bar blues uses I, IV and V over twelve bars: I I I I, IV IV I I, V IV I I, the last bar often V to turn round to the top. In A that is A, D and E.',
  ], [
    keep('th-major', mc('', 'What are the chord tones of a major triad?', '1, 3, 5', ['1, ♭3, 5', '1, 3, ♯5', '1, 4, 5'], 'Root, major third (4 semitones) and perfect fifth (7 semitones).', THEORY_SRC)),
    keep('th-minor', mc('', 'What are the chord tones of a minor triad?', '1, ♭3, 5', ['1, 3, 5', '1, ♭3, ♭5', '1, 2, 5'], 'Root, minor third (3 semitones) and perfect fifth.', THEORY_SRC)),
    keep('th-dim', mc('', 'What are the chord tones of a diminished triad?', '1, ♭3, ♭5', ['1, 3, ♭5', '1, ♭3, 5', '1, 3, ♯5'], 'Two stacked minor thirds.', THEORY_SRC)),
    mc('minor-degrees', 'In a major key, which scale degrees give minor triads?', '2, 3 and 6', ['1, 4 and 5', '2, 5 and 7', '3, 6 and 7'], 'I ii iii IV V vi vii°: lower case is minor.', THEORY_SRC),
    mc('not-in-g', 'Which chord is NOT diatonic to G major?', 'F major', ['C major', 'E minor', 'D major'], 'G major has F♯, so its chords are G Am Bm C D Em F♯dim.', THEORY_SRC),
    qa('nashville', 'In the Nashville number system, what is 1 4 5 in the key of E?', 'E, A and B.', THEORY_SRC),
    mc('nashville-minor', 'In the key of C, a Nashville chart says 6-. Which chord?', 'A minor', ['A major', 'F minor', 'E minor'], 'The 6th degree of C is A, and the minus marks it minor.', THEORY_SRC),
    mc('twelve-bar', 'A 12-bar blues in A uses which three chords?', 'A, D and E (I, IV and V)', ['A, C and G', 'A, Bm and E', 'A, D and F♯m'], 'The 1st, 4th and 5th degrees of A.', THEORY_SRC),
    qa('twelve-bar-form', 'How do the twelve bars of a standard blues run?', 'I I I I, IV IV I I, V IV I I (the last bar often V, to turn round to the top).', THEORY_SRC),
  ]),
  lesson('mus3', 4, 'The circle of fifths, inversions and the capo', [
    'The circle of fifths puts the keys in steps of a fifth. Clockwise from C: G D A E B F♯, each adding one sharp. Anticlockwise: F B♭ E♭ A♭ D♭ G♭, each adding one flat. Neighbours share all but one note, so they are closely related, and the IV and V of any key sit on either side of it.',
    'Inverting an interval moves its lower note up an octave. The two interval numbers add up to nine, major becomes minor (and minor major), and perfect stays perfect: a major third becomes a minor sixth, a perfect fifth a perfect fourth. That is why a fifth up and a fourth down land on the same letter.',
    'A capo clamps every string at one fret, acting as a new nut, so every chord shape sounds that many semitones higher. G shapes with a capo at fret 2 sound in A. To play in B♭ with G shapes, put the capo at fret 3. The sum: shape key plus capo frets equals the key you hear.',
  ], [
    mc('clockwise', 'Going clockwise round the circle of fifths from C, each key…', 'Adds one sharp', ['Adds one flat', 'Moves up a semitone', 'Loses one sharp'], 'C, G (one sharp), D (two), A (three) and on.', THEORY_SRC),
    mc('after-d', 'On the circle of fifths, which key comes after D going clockwise?', 'A', ['G', 'E', 'B'], 'A fifth above D is A, three sharps.', THEORY_SRC),
    qa('neighbours', 'Why are neighbouring keys on the circle of fifths closely related?', 'They share all but one note, and any key\'s IV and V sit right beside it.', THEORY_SRC),
    keep('th-inversion', qa('', 'What does a major third become when you invert it (move the lower note up an octave)?', 'A minor sixth. Inverted intervals add up to nine in number, and major becomes minor.', THEORY_SRC)),
    mc('fifth-inverts', 'A perfect fifth inverted becomes…', 'A perfect fourth', ['A perfect fifth', 'A minor sixth', 'A major fourth'], 'The numbers add to nine, and perfect stays perfect.', THEORY_SRC),
    qa('capo', 'What does a capo do to every chord shape?', 'Clamps the strings at one fret like a new nut, so every shape sounds that many semitones higher.', GUITAR_SRC),
    mc('capo-2', 'You play G-shape chords with a capo at fret 2. What key do you hear?', 'A', ['G', 'B', 'F♯'], 'Two semitones above G is A.', GUITAR_SRC),
    mc('capo-bb', 'The singer wants B♭. Which capo fret lets you use G-shape chords?', 'Fret 3', ['Fret 1', 'Fret 2', 'Fret 4'], 'G up three semitones: G♯, A, B♭.', GUITAR_SRC),
  ]),
  lesson('mus4', 4, 'Seventh chords and extensions', [
    'A seventh chord adds a fourth note, a third above the fifth. Major 7 (maj7): 1 3 5 7, the seventh 11 semitones above the root; smooth and jazzy. Dominant 7 (written just 7): 1 3 5 ♭7, the seventh 10 semitones up; bluesy, and it wants to move on. It is the V chord of a major key. Minor 7 (m7): 1 ♭3 5 ♭7. Half-diminished (m7♭5): 1 ♭3 ♭5 ♭7, the vii chord of a major key.',
    'In the blues all three chords are often played as dominant 7s: in A, A7, D7 and E7.',
    'Suspended chords replace the third: sus2 is 1 2 5 and sus4 is 1 4 5. With no third they are neither major nor minor, and sound open and unresolved. An add9 chord keeps the third and adds the 9th (the 2nd, an octave up): 1 3 5 9. A chord named just 9, such as C9, is a dominant 7 with a 9th on top.',
  ], [
    keep('th-dom7', qa('', 'What are the chord tones of a dominant 7 chord?', '1, 3, 5, ♭7.', THEORY_SRC)),
    qa('g7', 'Spell G7.', 'G, B, D, F.', THEORY_SRC),
    keep('th-maj7', qa('', 'What is the difference between Cmaj7 and C7?', 'Cmaj7 has a major seventh (B, 11 semitones up); C7 has a minor seventh (B♭, 10 semitones up).', THEORY_SRC)),
    mc('m7', 'What are the chord tones of a minor 7 chord?', '1, ♭3, 5, ♭7', ['1, 3, 5, ♭7', '1, ♭3, ♭5, ♭7', '1, ♭3, 5, 7'], 'A minor triad plus the ♭7.', THEORY_SRC),
    mc('half-dim', 'What are the chord tones of a half-diminished (m7♭5) chord?', '1, ♭3, ♭5, ♭7', ['1, ♭3, 5, ♭7', '1, 3, ♭5, ♭7', '1, ♭3, ♭5, 6'], 'A diminished triad plus the ♭7: the vii chord of a major key.', THEORY_SRC),
    mc('blues-7s', 'In a blues in A, the three chords are often played as…', 'A7, D7 and E7', ['Amaj7, Dmaj7 and Emaj7', 'Am7, Dm7 and Em7', 'A7, Dm7 and Emaj7'], 'Dominant 7s on I, IV and V give the blues its sound.', THEORY_SRC),
    mc('v7', 'In a major key, which diatonic chord is naturally a dominant 7?', 'The V chord', ['The I chord', 'The IV chord', 'The vi chord'], 'In C: G B D F. I and IV make maj7s, and ii, iii and vi make m7s.', THEORY_SRC),
    mc('sus4', 'What are the chord tones of a sus4 chord?', '1, 4, 5', ['1, 3, 4, 5', '1, 2, 5', '1, ♭3, 4'], 'The 4th replaces the third.', THEORY_SRC),
    qa('add9', 'How is Cadd9 different from Csus2?', 'Cadd9 keeps the third and adds D on top (C E G D); Csus2 replaces the third with D (C D G).', THEORY_SRC),
  ]),
  lesson('mus5', 4, 'Pentatonics, the blues scale and modes', [
    'The minor pentatonic scale has five notes: 1 ♭3 4 5 ♭7. A minor pentatonic is A C D E G. It is the core improvising scale of rock and blues: few of its notes clash with the chords. The blues scale adds the ♭5, the blue note: A C D E♭ E G. The major pentatonic is 1 2 3 5 6; C major pentatonic, C D E G A, has the same notes as A minor pentatonic.',
    'A mode is the major scale started from a different degree, so the same notes get a different home note and a different sound. On the white keys of a piano: Ionian C to C (the major scale), Dorian D to D (natural minor with a raised 6th), Phrygian E to E (minor with a ♭2), Lydian F to F (major with a ♯4), Mixolydian G to G (major with a ♭7), Aeolian A to A (natural minor), Locrian B to B (♭2 and ♭5).',
    'In use: Mixolydian fits a dominant 7 chord, since it has that chord\'s ♭7; Dorian suits minor grooves that sit on one or two chords; Lydian gives a bright, floating major sound.',
  ], [
    mc('minor-pent', 'Which notes make the A minor pentatonic scale?', 'A C D E G', ['A B C D E', 'A C D E♭ G', 'A C♯ E F♯ G'], '1 ♭3 4 5 ♭7 from A.', THEORY_SRC),
    mc('pent-formula', 'What is the minor pentatonic formula?', '1, ♭3, 4, 5, ♭7', ['1, 2, 3, 5, 6', '1, ♭3, 4, ♭5, 5, ♭7', '1, 2, ♭3, 5, ♭6'], 'The second option is the major pentatonic; the third the blues scale.', THEORY_SRC),
    qa('blue-note', 'Which note turns the minor pentatonic into the blues scale?', 'The ♭5, the blue note: in A, E♭.', THEORY_SRC),
    mc('same-notes', 'A minor pentatonic has the same notes as which major pentatonic?', 'C major pentatonic', ['A major pentatonic', 'E major pentatonic', 'G major pentatonic'], 'C is the relative major of A minor: C D E G A.', THEORY_SRC),
    qa('mode', 'What is a mode?', 'The major scale started from a different degree, so the same notes have a different home note and sound.', THEORY_SRC),
    keep('th-dorian', qa('', 'How is the Dorian mode built, and which white-key scale is it?', 'A natural minor scale with a raised 6th. On white keys, D to D.', B(15))),
    keep('th-mixolydian', mc('', 'The Mixolydian mode is…', 'A major scale with a ♭7', ['A major scale with a ♯4', 'A minor scale with a raised 6th', 'A minor scale with a ♭2'], 'On white keys, G to G. It suits dominant 7 chords.', B(15))),
    keep('th-lydian', qa('', 'How is the Lydian mode built?', 'A major scale with a raised (♯) 4th. On white keys, F to F.', B(15))),
    mc('mixo-use', 'Over an A7 vamp, which mode fits most naturally?', 'A Mixolydian', ['A Lydian', 'A Ionian (major)', 'A Phrygian'], 'Mixolydian is major with a ♭7: the notes of a dominant 7 chord plus the 2, 4 and 6.', THEORY_SRC),
  ]),
  lesson('mus6', 4, 'CAGED: chord shapes across the neck', [
    'Notes on the two low strings: string 6 (low E) is E open, F at fret 1, G at 3, A at 5, B at 7, C at 8, D at 10 and E again at 12. String 5 (A) is A open, B at 2, C at 3, D at 5, E at 7, F at 8, G at 10 and A at 12. The Fretboard and chords cards drill these.',
    'A barre chord is an open chord shape moved up the neck, with the index finger barring the strings as a new nut. The E shape has its root on string 6: at fret 3 it is G, at fret 5 A. The A shape has its root on string 5: at fret 5 it is D. The C shape also has its root on string 5, under the ring finger.',
    'CAGED names the five open major shapes: C, A, G, E and D. Moved up the neck, they join in that order to cover the whole fretboard for any one major chord: C shape, then A, G, E, D, then C again an octave up. Each shape sits inside one position of the scale around it, so the five chord shapes are also a map of five scale positions.',
  ], [
    keep('th-caged', qa('', 'What is the CAGED system?', 'A way to map the neck: the five open chord shapes C, A, G, E and D, moved up the neck as barre shapes, connect in that order to cover the fretboard for any major chord.', GUITAR_SRC)),
    mc('string6-fret8', 'Which note is at fret 8 of the low E string?', 'C', ['B', 'C♯', 'D'], 'E, F (1), G (3), A (5), B (7), C (8).', GUITAR_SRC),
    keep('th-e-shape-3', mc('', 'An E-shape barre chord at the 3rd fret is which chord?', 'G major', ['A major', 'C major', 'F major'], 'The root is on the 6th string, and the 6th string at fret 3 is G.', GUITAR_SRC)),
    mc('e-shape-5', 'An E-shape barre chord at the 5th fret is which chord?', 'A major', ['E major', 'D major', 'B major'], 'Root on string 6; string 6 at fret 5 is A.', GUITAR_SRC),
    keep('th-a-shape-5', qa('', 'An A-shape barre with its root at the 5th fret of the A string is which chord?', 'D major: the A string at fret 5 is D.', GUITAR_SRC)),
    mc('c-shape-root', 'Where is the root of a C-shape chord?', 'On the 5th string, under the ring finger', ['On the 6th string, under the index finger', 'On the 1st string, under the little finger', 'On the 4th string, played open'], 'In an open C, the ring finger frets C at the 3rd fret of the A string.', GUITAR_SRC),
    keep('th-caged-next', mc('', 'Going up the neck in CAGED order, which shape comes after the E shape?', 'The D shape', ['The C shape', 'The A shape', 'The G shape'], 'The order cycles C, A, G, E, D, then C again an octave up.', GUITAR_SRC)),
    qa('caged-scale', 'Why is CAGED also a map for scales?', 'Each chord shape sits inside one position of the scale, so the five shapes in order give five linked scale positions up the neck.', GUITAR_SRC),
  ]),
];
