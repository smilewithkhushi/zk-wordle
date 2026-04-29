// ---------------------------------------------------------------------------
// ZK Wordle circuit
// Private inputs : guesses, target  (never leave the user's machine)
// Public inputs  : commitment, daily_salt, attempt_count, feedback
// ---------------------------------------------------------------------------
fn main(
    guesses:       [[u8; 5]; 6],     // private - the words you actually typed
    target:        [u8; 5],          // private - today's answer
    commitment:    pub Field,         // public  - poseidon(word_as_field, daily_salt)
    daily_salt:    pub Field,         // public  - date as field (YYYYMMDD)
    attempt_count: pub u8,            // public  - how many guesses you used (1-6)
    feedback:      pub [[u8; 5]; 6]  // public  - tile colors: GREEN=2, YELLOW=1, GRAY=0
) {
    // -----------------------------------------------------------------------
    // 1. Commitment check
    //    Proves you knew the correct target word.
    //    poseidon(word_as_field, daily_salt) must equal the published commitment.
    // -----------------------------------------------------------------------
    let word_as_field = letters_to_field(target);
    let computed_commitment = std::hash::pedersen_hash([word_as_field, daily_salt]);
    assert(computed_commitment == commitment);

    // -----------------------------------------------------------------------
    // 2. Attempt honesty check
    //    Proves you used exactly `attempt_count` guesses, not fewer.
    //    Every guess before the last must NOT equal the target.
    //    The guess at attempt_count - 1 MUST equal the target.
    // -----------------------------------------------------------------------
    for i in 0..6 {
        if (i as u8) < attempt_count - 1 {
            assert(!arrays_equal(guesses[i], target));
        }
        if (i as u8) == attempt_count - 1 {
            assert(arrays_equal(guesses[i], target));
        }
    }

    // -----------------------------------------------------------------------
    // 3. Feedback honesty check
    //    Proves every tile colour in the public feedback grid was computed
    //    correctly from the actual (private) guesses and target.
    //    Only checks rows up to attempt_count - unused rows are ignored.
    // -----------------------------------------------------------------------
    for g in 0..6 {
        if (g as u8) < attempt_count {
            for pos in 0..5 {
                let computed_tile = compute_tile(guesses[g][pos], target, pos as u32);
                assert(computed_tile == feedback[g][pos]);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// letters_to_field
// Encodes a 5-letter word into a single field element.
// Encoding: a=1, b=2, ..., z=26, padding=0
// Packing:  letter[0]*32^4 + letter[1]*32^3 + ... + letter[4]
// 5 letters x 5 bits = 25 bits total - safely within the bn254 field.
// ---------------------------------------------------------------------------
fn letters_to_field(word: [u8; 5]) -> Field {
    let mut result: Field = 0;
    result = result + (word[0] as Field) * 1048576; // 32^4
    result = result + (word[1] as Field) * 32768;   // 32^3
    result = result + (word[2] as Field) * 1024;    // 32^2
    result = result + (word[3] as Field) * 32;      // 32^1
    result = result + (word[4] as Field);            // 32^0
    result
}

// ---------------------------------------------------------------------------
// arrays_equal
// Returns true if two 5-letter arrays are identical.
// ---------------------------------------------------------------------------
fn arrays_equal(a: [u8; 5], b: [u8; 5]) -> bool {
    (a[0] == b[0]) &
    (a[1] == b[1]) &
    (a[2] == b[2]) &
    (a[3] == b[3]) &
    (a[4] == b[4])
}

// ---------------------------------------------------------------------------
// compute_tile
// Computes the correct tile colour for one letter at one position.
//   GREEN  (2) - letter matches the target at this exact position
//   YELLOW (1) - letter appears somewhere in the target, but not here
//   GRAY   (0) - letter does not appear in the target at all
// ---------------------------------------------------------------------------
fn compute_tile(guess_letter: u8, target: [u8; 5], pos: u32) -> u8 {
    if guess_letter == target[pos] {
        2 // GREEN
    } else if letter_in_target(guess_letter, target) {
        1 // YELLOW
    } else {
        0 // GRAY
    }
}

// ---------------------------------------------------------------------------
// letter_in_target
// Returns true if `letter` appears anywhere in the 5-letter target array.
// ---------------------------------------------------------------------------
fn letter_in_target(letter: u8, target: [u8; 5]) -> bool {
    (letter == target[0]) |
    (letter == target[1]) |
    (letter == target[2]) |
    (letter == target[3]) |
    (letter == target[4])
}
