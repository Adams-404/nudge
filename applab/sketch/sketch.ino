/*
 * Nudge - Pip MCU Sketch for Arduino UNO Q
 * 
 * Drives the 8x13 LED Matrix face, listens for physical Allow / Deny buttons,
 * detects pokes, and communicates with the Python agent via Arduino_RouterBridge.
 *
 * Moods: idle | peek | watching | needs_you | happy | annoyed | dizzy | asleep
 */

#include "Arduino_LED_Matrix.h"
#include "Arduino_RouterBridge.h"

// Hardware Pin Definitions
const int PIN_BTN_ALLOW = 2; // Green / Allow button (active LOW)
const int PIN_BTN_DENY  = 3; // Red / Deny button (active LOW)
const int PIN_BTN_POKE  = 4; // Capacitive / Poke button (active LOW)

ArduinoLEDMatrix matrix;

// Debounce timing (ms)
const unsigned long DEBOUNCE_MS = 50;
unsigned long lastAllowPressTime = 0;
unsigned long lastDenyPressTime  = 0;
unsigned long lastPokePressTime  = 0;

int lastAllowState = HIGH;
int lastDenyState  = HIGH;
int lastPokeState  = HIGH;

// Current Mood state
String currentMood = "idle";
unsigned long lastBlinkTime = 0;
unsigned long blinkInterval = 3500;
bool isBlinking = false;
unsigned long blinkStartTime = 0;

// Pulse timing for needs_you mood
unsigned long lastPulseTime = 0;
bool pulseState = false;

// 8x13 LED Matrix Frames (104 LEDs, row-major, 13 columns x 8 rows)
// The UNO Q matrix is 8x13 (NOT 12x8): draw() takes a 104-byte grayscale buffer.

#define ROW0  0,0,0,0,0,0,0,0,0,0,0,0,0
#define EYE_L 0,0,1,1,0,0,0,0,0,1,1,0,0
#define LIDS  0,0,1,1,1,0,0,0,1,1,1,0,0
#define SMILE 0,1,0,0,0,0,0,0,0,0,0,1,0
#define MOUTH 0,0,1,1,1,1,1,1,1,1,1,0,0

// idle: open eyes + smile
const uint8_t FRAME_IDLE[104] = {
    ROW0,
    EYE_L,
    EYE_L,
    ROW0,
    SMILE,
    MOUTH,
    ROW0,
    ROW0
};

// blink: closed lids for 180 ms
const uint8_t FRAME_BLINK[104] = {
    ROW0,
    ROW0,
    LIDS,
    ROW0,
    SMILE,
    MOUTH,
    ROW0,
    ROW0
};

// peek: hooded left eye, looking sideways
const uint8_t FRAME_PEEK[104] = {
    ROW0,
    0,1,1,1,0,0,0,0,0,1,1,0,0,
    EYE_L,
    ROW0,
    SMILE,
    MOUTH,
    ROW0,
    ROW0
};

// watching: wide attentive eyes + straight mouth
const uint8_t FRAME_WATCHING[104] = {
    0,1,1,1,0,0,0,0,0,1,1,1,0,
    0,1,1,1,0,0,0,0,0,1,1,1,0,
    0,1,1,1,0,0,0,0,0,1,1,1,0,
    ROW0,
    SMILE,
    0,1,1,1,1,1,1,1,1,1,1,1,0,
    ROW0,
    ROW0
};

// needs_you frame A: urgent wide eyes
const uint8_t FRAME_NEEDS_YOU_A[104] = {
    ROW0,
    0,1,1,1,1,0,0,0,1,1,1,1,0,
    0,1,1,1,1,0,0,0,1,1,1,1,0,
    ROW0,
    ROW0,
    0,1,1,1,1,1,1,1,1,1,1,1,0,
    ROW0,
    ROW0
};

// needs_you frame B: full-brightness flash
const uint8_t FRAME_NEEDS_YOU_B[104] = {
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1
};

// happy: ^^ victory eyes
const uint8_t FRAME_HAPPY[104] = {
    ROW0,
    EYE_L,
    0,1,0,0,1,0,0,0,1,0,0,1,0,
    1,0,0,0,0,1,1,0,0,0,0,0,1,
    SMILE,
    MOUTH,
    ROW0,
    ROW0
};

// annoyed: flat skeptical brows + flat mouth
const uint8_t FRAME_ANNOYED[104] = {
    ROW0,
    0,1,1,1,1,0,0,0,1,1,1,1,0,
    ROW0,
    ROW0,
    ROW0,
    0,1,1,1,1,1,1,1,1,1,1,1,0,
    ROW0,
    ROW0
};

// dizzy: crossed X eyes + wavy mouth
const uint8_t FRAME_DIZZY[104] = {
    0,1,0,0,0,1,0,1,0,0,0,1,0,
    0,0,1,0,1,0,0,0,1,0,1,0,0,
    0,1,0,0,0,1,0,1,0,0,0,1,0,
    ROW0,
    ROW0,
    0,0,1,0,1,0,1,0,1,0,1,0,0,
    ROW0,
    ROW0
};

// asleep: closed lids + z Z
const uint8_t FRAME_ASLEEP[104] = {
    0,0,0,0,0,0,0,0,0,0,1,1,1,
    0,0,0,0,0,0,0,0,0,0,0,0,1,
    0,0,0,0,0,0,0,0,0,0,1,1,1,
    LIDS,
    ROW0,
    SMILE,
    MOUTH,
    ROW0
};

// RPC callback invoked by Python on Linux MPU
void rpc_set_mood(String mood) {
    mood.trim();
    currentMood = mood;
    updateMoodMatrix();
}

void updateMoodMatrix() {
    if (currentMood == "idle") {
        matrix.draw(FRAME_IDLE);
    } else if (currentMood == "peek") {
        matrix.draw(FRAME_PEEK);
    } else if (currentMood == "watching") {
        matrix.draw(FRAME_WATCHING);
    } else if (currentMood == "needs_you") {
        matrix.draw(pulseState ? FRAME_NEEDS_YOU_A : FRAME_NEEDS_YOU_B);
    } else if (currentMood == "happy") {
        matrix.draw(FRAME_HAPPY);
    } else if (currentMood == "annoyed") {
        matrix.draw(FRAME_ANNOYED);
    } else if (currentMood == "dizzy") {
        matrix.draw(FRAME_DIZZY);
    } else if (currentMood == "asleep") {
        matrix.draw(FRAME_ASLEEP);
    } else {
        matrix.draw(FRAME_IDLE);
    }
}

void setup() {
    Serial.begin(115200);

    // Initialize physical buttons with internal pull-ups
    pinMode(PIN_BTN_ALLOW, INPUT_PULLUP);
    pinMode(PIN_BTN_DENY,  INPUT_PULLUP);
    pinMode(PIN_BTN_POKE,  INPUT_PULLUP);

    // Start LED matrix (frames are binary 0/1 grayscale)
    matrix.begin();
    matrix.setGrayscaleBits(1);
    updateMoodMatrix();

    // Start Router Bridge to Linux MPU
    Bridge.begin();
    Bridge.provide("set_mood", rpc_set_mood);

    Serial.println("Pip MCU initialized. Ready for Nudge agent.");
}

void loop() {
    unsigned long now = millis();

    // 1. Check Allow Button
    int allowVal = digitalRead(PIN_BTN_ALLOW);
    if (allowVal != lastAllowState) {
        if (allowVal == LOW && (now - lastAllowPressTime) > DEBOUNCE_MS) {
            lastAllowPressTime = now;
            Serial.println("BTN: ALLOW pressed");
            Bridge.call("on_mcu_event", "{\"type\":\"button\",\"action\":\"allow\"}");
        }
        lastAllowState = allowVal;
    }

    // 2. Check Deny Button
    int denyVal = digitalRead(PIN_BTN_DENY);
    if (denyVal != lastDenyState) {
        if (denyVal == LOW && (now - lastDenyPressTime) > DEBOUNCE_MS) {
            lastDenyPressTime = now;
            Serial.println("BTN: DENY pressed");
            Bridge.call("on_mcu_event", "{\"type\":\"button\",\"action\":\"deny\"}");
        }
        lastDenyState = denyVal;
    }

    // 3. Check Poke Sensor / Button
    int pokeVal = digitalRead(PIN_BTN_POKE);
    if (pokeVal != lastPokeState) {
        if (pokeVal == LOW && (now - lastPokePressTime) > DEBOUNCE_MS) {
            lastPokePressTime = now;
            Serial.println("BTN: POKE triggered");
            Bridge.call("on_mcu_event", "{\"type\":\"poke\"}");
        }
        lastPokeState = pokeVal;
    }

    // 4. Handle Mood Animations (Blinking & Pulsing)
    if (currentMood == "idle") {
        if (!isBlinking && (now - lastBlinkTime > blinkInterval)) {
            isBlinking = true;
            blinkStartTime = now;
            matrix.draw(FRAME_BLINK);
        } else if (isBlinking && (now - blinkStartTime > 180)) {
            isBlinking = false;
            lastBlinkTime = now;
            blinkInterval = random(2500, 5000);
            matrix.draw(FRAME_IDLE);
        }
    } else if (currentMood == "needs_you") {
        if (now - lastPulseTime > 350) {
            lastPulseTime = now;
            pulseState = !pulseState;
            matrix.draw(pulseState ? FRAME_NEEDS_YOU_A : FRAME_NEEDS_YOU_B);
        }
    }

    delay(10);
}
