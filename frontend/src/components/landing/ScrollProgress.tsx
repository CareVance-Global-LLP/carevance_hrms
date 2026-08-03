import { motion, useScroll, useSpring } from 'framer-motion';

export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-[9999] h-[2px] origin-left"
      style={{
        scaleX,
        background: 'linear-gradient(90deg, #5D969D, #3D656B)',
      }}
    />
  );
}
