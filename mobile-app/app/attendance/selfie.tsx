import React, { useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { selfieApi } from '../../src/api/endpoints';
import { useTheme } from '../../src/hooks/useTheme';
import { useToast } from '../../src/components/Toast';

export default function SelfieScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const toast = useToast();
  const cameraRef = React.useRef<CameraView>(null);
  const params = useLocalSearchParams<{ latitude: string; longitude: string; accuracy: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);

  const handleCapture = async () => {
    if (!cameraRef.current || done) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.4, base64: true });
      if (!photo?.base64) { toast.error('Camera did not return image data'); return; }
      await selfieApi.upload(photo.base64, {
        latitude: parseFloat(params.latitude || '0'),
        longitude: parseFloat(params.longitude || '0'),
        accuracy: parseFloat(params.accuracy || '0'),
      });
      setDone(true);
      // Was an Alert whose OK button did the navigation. Making somebody
      // dismiss a modal to get back to the screen they came from is a
      // tap that carries no information.
      toast.success('Selfie uploaded');
      router.replace('/(tabs)/attendance');
    } catch (err: any) {
      const serverMsg = err?.response?.data?.message;
      const status = err?.response?.status;
      if (serverMsg) toast.error(serverMsg);
      else if (status) toast.error(`Server error (HTTP ${status})`);
      else if (err?.code === 'ECONNABORTED') toast.error('Request timed out. Try a smaller photo or better connection.');
      else toast.error(`Connection failed: ${err?.message || 'unknown error'}`);
    } finally { setCapturing(false); }
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ textAlign: 'center', fontSize: 16, color: '#fff', marginBottom: 20 }}>Camera permission is required for selfie</Text>
          <TouchableOpacity onPress={requestPermission} style={{ backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front">
        <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 80 }}>
          <Text style={{ color: '#fff', fontSize: 16, marginBottom: 24, fontWeight: '600' }}>Position your face in frame</Text>
          <TouchableOpacity
            style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', marginBottom: 24, opacity: (capturing || done) ? 0.5 : 1 }}
            onPress={handleCapture} disabled={capturing || done}
          >
            <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' }} />
          </TouchableOpacity>
          <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 32 }} onPress={() => router.replace('/(tabs)/attendance')}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '500' }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}
