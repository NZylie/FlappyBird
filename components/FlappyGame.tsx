import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useFrameCallback,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { gameConfig, theme } from '../constants/theme';

const {
  BIRD_SIZE,
  PIPE_WIDTH,
  PIPE_CAP_WIDTH,
  PIPE_CAP_HEIGHT,
  GAP_SIZE,
  GRAVITY,
  JUMP_FORCE,
  PIPE_SPEED,
  GROUND_HEIGHT,
  MIN_GAP_EDGE,
} = gameConfig;

type GameState = 'idle' | 'playing' | 'over';

// ─── Pipe Pair ───────────────────────────────────────────
interface PipePairProps {
  pipeX: Animated.SharedValue<number>;
  gapY: Animated.SharedValue<number>;
  screenHeight: number;
}

function PipePair({ pipeX, gapY, screenHeight }: PipePairProps) {
  const topBodyStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: pipeX.value,
    top: 0,
    width: PIPE_WIDTH,
    height: Math.max(0, gapY.value - GAP_SIZE / 2),
  }));

  const topCapStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: pipeX.value - (PIPE_CAP_WIDTH - PIPE_WIDTH) / 2,
    top: gapY.value - GAP_SIZE / 2 - PIPE_CAP_HEIGHT,
    width: PIPE_CAP_WIDTH,
    height: PIPE_CAP_HEIGHT,
  }));

  const bottomBodyStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: pipeX.value,
    top: gapY.value + GAP_SIZE / 2 + PIPE_CAP_HEIGHT,
    width: PIPE_WIDTH,
    height: Math.max(0, screenHeight - GROUND_HEIGHT - (gapY.value + GAP_SIZE / 2 + PIPE_CAP_HEIGHT)),
  }));

  const bottomCapStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: pipeX.value - (PIPE_CAP_WIDTH - PIPE_WIDTH) / 2,
    top: gapY.value + GAP_SIZE / 2,
    width: PIPE_CAP_WIDTH,
    height: PIPE_CAP_HEIGHT,
  }));

  return (
    <>
      <Animated.View style={topBodyStyle}>
        <View style={pipeStyles.body}>
          <View style={pipeStyles.highlightLeft} />
          <View style={pipeStyles.shadowRight} />
        </View>
      </Animated.View>
      <Animated.View style={topCapStyle}>
        <View style={pipeStyles.cap}>
          <View style={pipeStyles.capHighlight} />
        </View>
      </Animated.View>
      <Animated.View style={bottomCapStyle}>
        <View style={pipeStyles.cap}>
          <View style={pipeStyles.capHighlight} />
        </View>
      </Animated.View>
      <Animated.View style={bottomBodyStyle}>
        <View style={pipeStyles.body}>
          <View style={pipeStyles.highlightLeft} />
          <View style={pipeStyles.shadowRight} />
        </View>
      </Animated.View>
    </>
  );
}

const pipeStyles = StyleSheet.create({
  body: {
    flex: 1,
    backgroundColor: theme.pipe,
    borderWidth: 2.5,
    borderColor: theme.pipeBorder,
    overflow: 'hidden',
  },
  cap: {
    flex: 1,
    backgroundColor: theme.pipe,
    borderWidth: 2.5,
    borderColor: theme.pipeBorder,
    borderRadius: 4,
    overflow: 'hidden',
  },
  highlightLeft: {
    position: 'absolute',
    left: 4,
    top: 0,
    bottom: 0,
    width: 9,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 2,
  },
  shadowRight: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 2,
  },
  capHighlight: {
    position: 'absolute',
    left: 5,
    top: 3,
    bottom: 3,
    width: 11,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 2,
  },
});

// ─── Main Game ───────────────────────────────────────────
export default function FlappyGame() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const BIRD_X = screenWidth * 0.24;
  const pipeSpacing = Math.max(screenWidth * 0.55, 200);
  const minGapY = MIN_GAP_EDGE + GAP_SIZE / 2;
  const maxGapY = screenHeight - GROUND_HEIGHT - MIN_GAP_EDGE - GAP_SIZE / 2;

  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);

  // Shared values
  const gameActive = useSharedValue(0);
  const birdY = useSharedValue(screenHeight / 2 - BIRD_SIZE / 2);
  const birdVelocity = useSharedValue(0);
  const birdRotation = useSharedValue(0);
  const scoreValue = useSharedValue(0);
  const groundX = useSharedValue(0);

  const pipe1X = useSharedValue(screenWidth + 60);
  const pipe1GapY = useSharedValue(screenHeight * 0.4);
  const pipe1Scored = useSharedValue(0);

  const pipe2X = useSharedValue(screenWidth + 60 + pipeSpacing);
  const pipe2GapY = useSharedValue(screenHeight * 0.55);
  const pipe2Scored = useSharedValue(0);

  const pipe3X = useSharedValue(screenWidth + 60 + pipeSpacing * 2);
  const pipe3GapY = useSharedValue(screenHeight * 0.45);
  const pipe3Scored = useSharedValue(0);

  // Load high score
  useEffect(() => {
    AsyncStorage.getItem('flappy_highscore').then((val) => {
      if (val) setHighScore(parseInt(val, 10));
    });
  }, []);

  // Idle bird bobbing
  useEffect(() => {
    if (gameState === 'idle') {
      const center = screenHeight / 2 - BIRD_SIZE / 2;
      birdY.value = center;
      birdRotation.value = 0;
      birdY.value = withRepeat(
        withSequence(
          withTiming(center - 20, {
            duration: 500,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(center + 20, {
            duration: 500,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1,
        true
      );
    }
  }, [gameState, screenHeight]);

  const handleCollisionHaptic = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, []);

  const showOverlay = useCallback(() => {
    const finalScore = scoreValue.value;
    setScore(finalScore);
    const isNew = finalScore > highScore;
    setIsNewBest(isNew);
    if (isNew) {
      setHighScore(finalScore);
      AsyncStorage.setItem('flappy_highscore', finalScore.toString());
    }
    setGameState('over');
  }, [highScore, scoreValue]);

  const updateScore = useCallback((newScore: number) => {
    setScore(newScore);
    Haptics.selectionAsync();
  }, []);

  // ─── Game Loop ─────────────────────────────────────────
  useFrameCallback((info) => {
    'worklet';
    if (gameActive.value === 0) return;

    const dt = Math.min((info.timeSincePreviousFrame || 16.67) / 16.67, 3);

    // Bird physics
    birdVelocity.value += GRAVITY * dt;
    birdY.value += birdVelocity.value * dt;

    // Bird rotation
    const target =
      birdVelocity.value < -2
        ? -28
        : Math.min(birdVelocity.value * 5, 90);
    birdRotation.value += (target - birdRotation.value) * 0.18;

    // Ground collision
    if (birdY.value + BIRD_SIZE >= screenHeight - GROUND_HEIGHT) {
      birdY.value = screenHeight - GROUND_HEIGHT - BIRD_SIZE;
      birdVelocity.value = 0;
      gameActive.value = 0;
      runOnJS(showOverlay)();
      return;
    }

    // Falling state (bird hit pipe, now dropping)
    if (gameActive.value === 2) return;

    // Ceiling
    if (birdY.value < 0) {
      birdY.value = 0;
      birdVelocity.value = 1;
    }

    // Ground scroll
    groundX.value -= PIPE_SPEED * dt;
    if (groundX.value <= -48) {
      groundX.value = 0;
    }

    // Pipe logic
    const allPipes = [
      { x: pipe1X, gapY: pipe1GapY, scored: pipe1Scored },
      { x: pipe2X, gapY: pipe2GapY, scored: pipe2Scored },
      { x: pipe3X, gapY: pipe3GapY, scored: pipe3Scored },
    ];

    const bLeft = BIRD_X + 5;
    const bRight = BIRD_X + BIRD_SIZE - 5;
    const bTop = birdY.value + 5;
    const bBottom = birdY.value + BIRD_SIZE - 5;

    for (let i = 0; i < allPipes.length; i++) {
      const pipe = allPipes[i];
      pipe.x.value -= PIPE_SPEED * dt;

      // Recycle
      if (pipe.x.value < -(PIPE_CAP_WIDTH + 20)) {
        let rightmost = -9999;
        for (let j = 0; j < allPipes.length; j++) {
          if (allPipes[j].x.value > rightmost) rightmost = allPipes[j].x.value;
        }
        pipe.x.value = rightmost + pipeSpacing;
        const range = maxGapY - minGapY;
        pipe.gapY.value = minGapY + Math.random() * range;
        pipe.scored.value = 0;
      }

      // Collision
      const pLeft = pipe.x.value;
      const pRight = pipe.x.value + PIPE_WIDTH;
      const gTop = pipe.gapY.value - GAP_SIZE / 2;
      const gBottom = pipe.gapY.value + GAP_SIZE / 2;

      if (bRight > pLeft && bLeft < pRight) {
        if (bTop < gTop || bBottom > gBottom) {
          gameActive.value = 2;
          birdVelocity.value = -3;
          runOnJS(handleCollisionHaptic)();
          return;
        }
      }

      // Score
      if (bLeft > pRight && pipe.scored.value === 0) {
        pipe.scored.value = 1;
        scoreValue.value += 1;
        runOnJS(updateScore)(scoreValue.value);
      }
    }
  });

  // ─── Animated Styles ───────────────────────────────────
  const birdStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: BIRD_X,
    top: birdY.value,
    width: BIRD_SIZE,
    height: BIRD_SIZE,
    transform: [{ rotate: `${birdRotation.value}deg` }],
  }));

  const groundAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: groundX.value }],
  }));

  // ─── Actions ───────────────────────────────────────────
  const startGame = useCallback(() => {
    cancelAnimation(birdY);

    birdY.value = screenHeight / 2 - BIRD_SIZE / 2;
    birdVelocity.value = JUMP_FORCE;
    birdRotation.value = -28;

    scoreValue.value = 0;
    setScore(0);
    setIsNewBest(false);

    const range = maxGapY - minGapY;
    pipe1X.value = screenWidth + 60;
    pipe1GapY.value = minGapY + Math.random() * range;
    pipe1Scored.value = 0;

    pipe2X.value = screenWidth + 60 + pipeSpacing;
    pipe2GapY.value = minGapY + Math.random() * range;
    pipe2Scored.value = 0;

    pipe3X.value = screenWidth + 60 + pipeSpacing * 2;
    pipe3GapY.value = minGapY + Math.random() * range;
    pipe3Scored.value = 0;

    groundX.value = 0;
    gameActive.value = 1;
    setGameState('playing');

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [screenWidth, screenHeight, pipeSpacing, minGapY, maxGapY]);

  const flap = useCallback(() => {
    birdVelocity.value = JUMP_FORCE;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleTap = useCallback(() => {
    if (gameState === 'idle') startGame();
    else if (gameState === 'playing') flap();
  }, [gameState, startGame, flap]);

  const restart = useCallback(() => {
    setGameState('idle');
  }, []);

  const getMedal = (s: number) => {
    if (s >= 40) return { label: 'Platinum', color: '#E5E4E2' };
    if (s >= 30) return { label: 'Gold', color: '#FFD700' };
    if (s >= 20) return { label: 'Silver', color: '#C0C0C0' };
    if (s >= 10) return { label: 'Bronze', color: '#CD7F32' };
    return null;
  };

  const groundStripes = Math.ceil(screenWidth / 24) + 4;

  return (
    <View style={styles.root}>
      <Pressable style={styles.root} onPress={handleTap}>
        {/* Sky */}
        <LinearGradient
          colors={[theme.skyTop, theme.skyMid, theme.skyBottom]}
          style={StyleSheet.absoluteFill}
        />

        {/* Clouds */}
        {[
          { t: 0.09, l: 0.08, w: 85, h: 30 },
          { t: 0.17, l: 0.52, w: 110, h: 36 },
          { t: 0.06, l: 0.78, w: 65, h: 24 },
          { t: 0.26, l: 0.28, w: 95, h: 30 },
          { t: 0.14, l: -0.02, w: 70, h: 26 },
        ].map((c, i) => (
          <View
            key={i}
            style={[
              styles.cloud,
              {
                top: screenHeight * c.t,
                left: screenWidth * c.l,
                width: c.w,
                height: c.h,
              },
            ]}
          />
        ))}

        {/* Pipes */}
        <PipePair pipeX={pipe1X} gapY={pipe1GapY} screenHeight={screenHeight} />
        <PipePair pipeX={pipe2X} gapY={pipe2GapY} screenHeight={screenHeight} />
        <PipePair pipeX={pipe3X} gapY={pipe3GapY} screenHeight={screenHeight} />

        {/* Ground */}
        <View style={[styles.groundContainer, { height: GROUND_HEIGHT }]}>
          <View style={styles.grassStrip} />
          <View style={styles.groundBase}>
            <Animated.View style={[styles.groundStripesRow, groundAnimStyle]}>
              {Array.from({ length: groundStripes }, (_, i) => (
                <View
                  key={i}
                  style={[
                    styles.groundStripe,
                    { left: i * 48 },
                    i % 2 === 0 ? styles.stripeDark : styles.stripeLight,
                  ]}
                />
              ))}
            </Animated.View>
          </View>
        </View>

        {/* Bird */}
        <Animated.View style={birdStyle}>
          <Image
            source={require('../assets/images/bird.png')}
            style={styles.birdImage}
            contentFit="contain"
          />
        </Animated.View>

        {/* Score (playing) */}
        {gameState === 'playing' && (
          <View style={[styles.scoreWrap, { top: insets.top + 24 }]}>
            <Text style={styles.scoreText}>{score}</Text>
          </View>
        )}

        {/* Idle screen */}
        {gameState === 'idle' && (
          <View style={styles.centerOverlay}>
            <Text style={styles.titleText}>Flappy Bird</Text>
            <View style={styles.tapPill}>
              <Text style={styles.tapText}>Tap to Play</Text>
            </View>
            {highScore > 0 && (
              <Text style={styles.idleBest}>Best: {highScore}</Text>
            )}
          </View>
        )}

        {/* Game Over */}
        {gameState === 'over' && (
          <View style={styles.gameOverOverlay}>
            <View style={styles.card}>
              <Text style={styles.goTitle}>Game Over</Text>

              <View style={styles.divider} />

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Score</Text>
                <Text style={styles.statValue}>{score}</Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Best</Text>
                <View style={styles.bestRow}>
                  {isNewBest && (
                    <View style={styles.newBadge}>
                      <Text style={styles.newBadgeText}>NEW</Text>
                    </View>
                  )}
                  <Text style={styles.statValue}>
                    {Math.max(score, highScore)}
                  </Text>
                </View>
              </View>

              {getMedal(score) && (
                <View
                  style={[
                    styles.medalPill,
                    { backgroundColor: getMedal(score)!.color + '35' },
                  ]}
                >
                  <Text style={styles.medalIcon}>
                    {score >= 40 ? '🏆' : score >= 30 ? '🥇' : score >= 20 ? '🥈' : '🥉'}
                  </Text>
                  <Text style={styles.medalLabel}>
                    {getMedal(score)!.label}
                  </Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.restartBtn,
                  pressed && styles.restartBtnPressed,
                ]}
                onPress={restart}
              >
                <Text style={styles.restartBtnText}>Play Again</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Clouds
  cloud: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 20,
  },

  // Ground
  groundContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  grassStrip: {
    height: 8,
    backgroundColor: '#6B8E23',
    zIndex: 1,
  },
  groundBase: {
    flex: 1,
    backgroundColor: '#DED895',
    overflow: 'hidden',
  },
  groundStripesRow: {
    flexDirection: 'row',
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '200%',
  },
  groundStripe: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: '100%',
  },
  stripeDark: {
    backgroundColor: 'rgba(160,140,60,0.2)',
  },
  stripeLight: {
    backgroundColor: 'transparent',
  },

  // Bird
  birdImage: {
    width: '100%',
    height: '100%',
  },

  // Score
  scoreWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  scoreText: {
    fontSize: 60,
    fontWeight: '900',
    color: theme.white,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 2, height: 3 },
    textShadowRadius: 4,
  },

  // Idle
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleText: {
    fontSize: 50,
    fontWeight: '900',
    color: theme.white,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 2, height: 3 },
    textShadowRadius: 5,
    marginBottom: 20,
  },
  tapPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  tapText: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.white,
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  idleBest: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginTop: 24,
    textShadowColor: 'rgba(0,0,0,0.12)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 1,
  },

  // Game Over
  gameOverOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.gameOverBg,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  card: {
    backgroundColor: theme.cardBg,
    borderRadius: 22,
    padding: 30,
    width: '78%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 3,
    borderColor: theme.cardBorder,
  },
  goTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: theme.brown,
    letterSpacing: 0.5,
  },
  divider: {
    width: '90%',
    height: 2,
    backgroundColor: '#E8D5A3',
    marginVertical: 18,
    borderRadius: 1,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 10,
  },
  statLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.brownLight,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '900',
    color: theme.brown,
  },
  bestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  newBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.white,
    letterSpacing: 0.5,
  },
  medalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
  },
  medalIcon: {
    fontSize: 20,
  },
  medalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#5D4037',
  },
  restartBtn: {
    marginTop: 26,
    backgroundColor: theme.button,
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
    borderWidth: 2.5,
    borderColor: theme.buttonBorder,
  },
  restartBtnPressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.9,
  },
  restartBtnText: {
    fontSize: 21,
    fontWeight: '800',
    color: theme.white,
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
});
