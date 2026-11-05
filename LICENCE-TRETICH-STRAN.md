# Licence třetích stran

Kromě vlastního kódu obsahuje aplikace Výkaz vozů tyto cizí součásti. Všechny jsou pod volnými licencemi (MIT, Apache 2.0, BSD 3-Clause), které dovolují použití i šíření, také komerční. Podmínkou je přiložit text licence a zachovat údaje o autorech – to plní tento soubor a soubory licencí, na které odkazuje. Převzaté součásti nejsou upravené; síť na přestavovače je vlastní, dotrénovaná z předtrénovaných vah (viz níže).

Ověřeno 5. 11. 2026.

## Čtení nápisů (číslo vozu a údaje z vozu)

### PaddleOCR PP-OCRv5 mobile – neuronové sítě

| Soubor | Co to je |
|---|---|
| `models/det.onnx` | PP-OCRv5_mobile_det – najde na fotce řádky textu |
| `models/rec_latin.onnx` | latin_PP-OCRv5_mobile_rec – přečte řádek (latinka včetně české diakritiky) |
| `models/rec_latin_dict.txt` | ppocrv5_latin_dict.txt – znaky, které čtecí síť zná |

- Autor: PaddlePaddle Authors – <https://github.com/PaddlePaddle/PaddleOCR>
- Licence: Apache License 2.0, Copyright (c) 2016 PaddlePaddle Authors. All Rights Reserved. Text licence: [`models/LICENSE`](models/LICENSE).
- Původ: sítě ve formátu ONNX z repozitáře <https://huggingface.co/snowfluke/ppu-paddle-ocr-models> (PT Perkasa Pilar Utama, Apache 2.0; podle jeho README převzaté z <https://www.paddleocr.ai>), soubory `detection/PP-OCRv5_mobile_det_infer.onnx` a `recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx` – beze změny, jen přejmenované. Slovník je beze změny `ppocr/utils/dict/ppocrv5_latin_dict.txt` z repozitáře PaddleOCR.
- Kontrolní součty SHA-256 (shodné se soubory v revizi `bf1d5ed` repozitáře snowfluke a se slovníkem v repozitáři PaddleOCR):
  - `det.onnx` d7fe3ea74652890722c0f4d02458b7261d9f5ae6c92904d05707c9eb155c7924
  - `rec_latin.onnx` 497dbed20b7fd86334c9deb5082c2958982a316bb16e3589ebc6502cd85cae79
  - `rec_latin_dict.txt` ccbcc45730b3fbbd9050c5bc74db6a99067141ef1035e3d14889a84a6b9b1aff

### ONNX Runtime Web 1.20.1 – spouští sítě v telefonu

- Soubory: `vendor/ort/ort.wasm.min.mjs`, `vendor/ort/ort-wasm-simd-threaded.mjs`, `vendor/ort/ort-wasm-simd-threaded.wasm`
- Autor: Microsoft Corporation – <https://github.com/microsoft/onnxruntime>
- Licence: MIT, text licence: [`vendor/ort/LICENSE`](vendor/ort/LICENSE).
- Součásti jiných autorů zabudované do ONNX Runtime: [`vendor/ort/ThirdPartyNotices.txt`](vendor/ort/ThirdPartyNotices.txt) – seznam Microsoftu z repozitáře ONNX Runtime, verze v1.20.1 (platí pro všechna sestavení ONNX Runtime, nejen pro webové).

## Poloha přestavovače brzdy

### Síť na přestavovač G/P – `models/rezim_*.onnx` (aktuální soubor uvádí `models/brzdy.json`)

- Vlastní síť, natrénovaná na fotkách z aplikace (`training/trenink_prestavovacu.ipynb`).
- Stavba sítě MobileNetV3 Small z knihovny torchvision (PyTorch) – <https://github.com/pytorch/vision>, licence BSD 3-Clause (text níže).
- Trénink začíná z vah předtrénovaných na datové sadě ImageNet, které torchvision dává ke stažení (`MobileNet_V3_Small_Weights.DEFAULT`). Torchvision k nim upozorňuje, že předtrénované modely mohou mít podmínky odvozené od dat, na kterých byly natrénované; samostatnou licenci váhy nemají.

## Obrazovky

### Preact a htm – `vendor/preact-htm.js`

Sestavení `htm/preact/standalone` (Preact 10 + htm 3 v jednom souboru), stejný soubor jako v aplikaci Závady vozů.

- Preact – Jason Miller, licence MIT (text níže) – <https://github.com/preactjs/preact>
- htm – Google Inc., licence Apache License 2.0, Copyright 2018 Google Inc. (text licence stejný jako [`models/LICENSE`](models/LICENSE)) – <https://github.com/developit/htm>

## Data

### Řady vozů – `data/rady.json`

Převod tabulky Evropské agentury pro železnice (ERA) „Assignment of EVN“, Appendix 6, Part 9 (`appendix_6_p9_en.xls`) skriptem `tools/era_rady.py` – zdroj: <https://www.era.europa.eu/domains/registers/evr_en>.

## Texty licencí

### Preact (MIT)

```
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### torchvision (BSD 3-Clause)

```
BSD 3-Clause License

Copyright (c) Soumith Chintala 2016, 
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

ONNX Runtime (MIT): [`vendor/ort/LICENSE`](vendor/ort/LICENSE). Apache License 2.0 (PaddleOCR, htm): [`models/LICENSE`](models/LICENSE).
