
import torch
import torchaudio
# Preload model
model, _ = torch.hub.load(repo_or_dir='snakers4/silero-models',
                          model='silero_tts',
                          language='ru',
                          speaker='v3_1_ru')
model.to('cpu')
print("MODEL_LOADED")
    