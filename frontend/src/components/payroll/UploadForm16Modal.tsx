import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, Archive, Download, File, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';

interface UploadForm16ModalProps {
  isOpen: boolean;
  onClose: () => void;
  financialYear: string;
  organizationName: string;
}

interface UnmatchedFile {
  filename: string;
  extracted_pan: string;
  reason: string;
}

export default function UploadForm16Modal({
  isOpen,
  onClose,
  financialYear,
  organizationName,
}: UploadForm16ModalProps) {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [partAFile, setPartAFile] = useState<File | null>(null);
  const [partBFile, setPartBFile] = useState<File | null>(null);
  const [partAError, setPartAError] = useState<string | null>(null);
  const [partBError, setPartBError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{
    matched: number;
    unmatched: UnmatchedFile[];
    invalid_files: string[];
  } | null>(null);

  const partAInputRef = useRef<HTMLInputElement>(null);
  const partBInputRef = useRef<HTMLInputElement>(null);

  const fyStart = financialYear.split('-')[0] || '2025';
  const fyEnd = financialYear.split('-')[1] || '2026';

  const validateZipFile = (file: File): boolean => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return false;
    }
    if (file.size > 100 * 1024 * 1024) { // 100MB limit
      return false;
    }
    return true;
  };

  const handleFileSelect = (type: 'A' | 'B', file: File | null) => {
    if (type === 'A') {
      setPartAError(null);
      if (file && !validateZipFile(file)) {
        setPartAError('Please select a valid .zip file (max 100MB)');
        setPartAFile(null);
        return;
      }
      setPartAFile(file);
    } else {
      setPartBError(null);
      if (file && !validateZipFile(file)) {
        setPartBError('Please select a valid .zip file (max 100MB)');
        setPartBFile(null);
        return;
      }
      setPartBFile(file);
    }
  };

  const handleDrop = (type: 'A' | 'B', e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0] || null;
    handleFileSelect(type, file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) =>
      payrollApi.uploadForm16(formData, (progress) => setUploadProgress(progress)).then((r) => r.data),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['employee-documents'] });
      show({ kind: 'success', message: `Form 16 uploaded. ${data.matched} employee(s) matched.`, durationMs: 5000 });
      if (data.unmatched.length === 0 && data.invalid_files.length === 0) {
        setTimeout(() => {
          onClose();
          setPartAFile(null);
          setPartBFile(null);
          setResult(null);
        }, 1500);
      }
    },
    onError: (e: any) => {
      const msg = getApiErrorMessage(e, 'Failed to upload Form 16 files');
      show({ kind: 'error', message: msg, durationMs: 8000 });
      setUploadProgress(null);
    },
  });

  const handleSubmit = () => {
    if (!partAFile || !partBFile) return;

    const formData = new FormData();
    formData.append('part_a_zip', partAFile);
    formData.append('part_b_zip', partBFile);
    formData.append('financial_year', financialYear);

    uploadMutation.mutate(formData);
  };

  const handleClose = () => {
    if (uploadMutation.isPending) return;
    onClose();
    setPartAFile(null);
    setPartBFile(null);
    setPartAError(null);
    setPartBError(null);
    setResult(null);
    setUploadProgress(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      
      {/* Slide-over panel */}
      <div className="relative ml-auto w-full max-w-4xl h-full bg-white shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between p-5 border-b border-slate-200 bg-slate-50">
          <h2 className="text-xl font-bold text-slate-900">
            Upload Form 16 for FY {fyStart}-{fyEnd}
          </h2>
          <button
            onClick={handleClose}
            disabled={uploadMutation.isPending}
            className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-30"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left column - Upload zones */}
          <div className="flex-1 p-5 overflow-y-auto">
            {/* Legal Entity */}
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">LEGAL ENTITY</p>
              <p className="text-sm text-slate-900">{organizationName}</p>
            </div>

            {/* Upload Card */}
            <SurfaceCard className="p-5">
              <h3 className="text-base font-semibold text-slate-900 mb-4">Upload signed Part A and Part B</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Part A Drop Zone */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Part A</label>
                  <div
                    className={cn(
                      'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
                      partAFile
                        ? 'border-emerald-300 bg-emerald-50'
                        : partAError
                        ? 'border-rose-300 bg-rose-50'
                        : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
                    )}
                    onClick={() => partAInputRef.current?.click()}
                    onDrop={(e) => handleDrop('A', e)}
                    onDragOver={handleDragOver}
                  >
                    <input
                      ref={partAInputRef}
                      type="file"
                      accept=".zip"
                      onChange={(e) => handleFileSelect('A', e.target.files?.[0] || null)}
                      className="hidden"
                      disabled={uploadMutation.isPending}
                    />
                    <Archive className={cn(
                      'h-10 w-10 mx-auto mb-3',
                      partAFile ? 'text-emerald-600' : partAError ? 'text-rose-500' : 'text-slate-400',
                    )} />
                    {partAFile ? (
                      <div>
                        <p className="text-sm font-medium text-emerald-700 mb-1">{partAFile.name}</p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPartAFile(null);
                          }}
                          className="text-xs text-slate-500 underline hover:text-slate-700"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-medium text-slate-700 mb-1">Browse your Files</p>
                        <p className="text-xs text-slate-500">or drag and drop your zip file here</p>
                      </div>
                    )}
                  </div>
                  {partAError && (
                    <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" /> {partAError}
                    </p>
                  )}
                </div>

                {/* Part B Drop Zone */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Part B</label>
                  <div
                    className={cn(
                      'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
                      partBFile
                        ? 'border-emerald-300 bg-emerald-50'
                        : partBError
                        ? 'border-rose-300 bg-rose-50'
                        : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
                    )}
                    onClick={() => partBInputRef.current?.click()}
                    onDrop={(e) => handleDrop('B', e)}
                    onDragOver={handleDragOver}
                  >
                    <input
                      ref={partBInputRef}
                      type="file"
                      accept=".zip"
                      onChange={(e) => handleFileSelect('B', e.target.files?.[0] || null)}
                      className="hidden"
                      disabled={uploadMutation.isPending}
                    />
                    <Archive className={cn(
                      'h-10 w-10 mx-auto mb-3',
                      partBFile ? 'text-emerald-600' : partBError ? 'text-rose-500' : 'text-slate-400',
                    )} />
                    {partBFile ? (
                      <div>
                        <p className="text-sm font-medium text-emerald-700 mb-1">{partBFile.name}</p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPartBFile(null);
                          }}
                          className="text-xs text-slate-500 underline hover:text-slate-700"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-medium text-slate-700 mb-1">Browse your Files</p>
                        <p className="text-xs text-slate-500">or drag and drop your zip file here</p>
                      </div>
                    )}
                  </div>
                  {partBError && (
                    <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" /> {partBError}
                    </p>
                  )}
                </div>
              </div>

              {/* Progress bar during upload */}
              {uploadMutation.isPending && uploadProgress !== null && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-700">Uploading...</span>
                    <span className="text-xs text-slate-500">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Upload Button */}
              <div className="mt-6 flex justify-start">
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={!partAFile || !partBFile || uploadMutation.isPending}
                  iconLeft={uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                >
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </SurfaceCard>

            {/* Upload Result */}
            {result && (
              <div className="mt-5 space-y-4">
                {result.unmatched.length > 0 && (
                  <SurfaceCard className="p-5 border-amber-200 bg-amber-50">
                    <div className="flex items-start gap-3 mb-3">
                      <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-semibold text-amber-900">Unmatched Files ({result.unmatched.length})</h3>
                        <p className="text-xs text-amber-700 mt-1">
                          These files could not be matched to employees. Check that PAN numbers are correct in employee profiles.
                        </p>
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-amber-100 sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-medium text-amber-900">Filename</th>
                            <th className="text-left p-2 font-medium text-amber-900">Extracted PAN</th>
                            <th className="text-left p-2 font-medium text-amber-900">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100">
                          {result.unmatched.map((f, i) => (
                            <tr key={i} className="bg-white">
                              <td className="p-2 font-mono text-xs text-slate-700">{f.filename}</td>
                              <td className="p-2 font-mono text-xs text-slate-700">{f.extracted_pan}</td>
                              <td className="p-2 text-xs text-amber-700">{f.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </SurfaceCard>
                )}

                {result.invalid_files.length > 0 && (
                  <SurfaceCard className="p-5 border-rose-200 bg-rose-50">
                    <div className="flex items-start gap-3 mb-3">
                      <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-semibold text-rose-900">Invalid Files ({result.invalid_files.length})</h3>
                        <p className="text-xs text-rose-700 mt-1">
                          These files failed validation (not valid .zip files or wrong format).
                        </p>
                      </div>
                    </div>
                    <ul className="text-sm text-rose-700 space-y-1">
                      {result.invalid_files.map((f, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span>•</span>
                          <span className="font-mono text-xs">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </SurfaceCard>
                )}

                {result.matched > 0 && result.unmatched.length === 0 && result.invalid_files.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    All {result.matched} Form 16 files uploaded successfully.
                  </div>
                )}

                <div className="flex justify-end">
                  <Button variant="secondary" onClick={handleClose}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Right column - Steps sidebar */}
          <div className="w-80 border-l border-slate-200 bg-slate-50/50 p-5 overflow-y-auto">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Steps to upload Form 16</h3>

            <ol className="space-y-4">
              <li className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Download className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Download Part A and Part B</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Download the Part A and Part B zip files for the selected Legal Entity from{' '}
                    <a
                      href="https://www.tdscpc.gov.in"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline hover:text-blue-700"
                    >
                      TRACES
                    </a>.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <File className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Convert and sign</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Convert the downloaded files into PDFs and sign them using a PDF signing utility.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Archive className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Compress separately</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Compress the Part A PDF files and Part B PDF files into 2 separate zip files.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">Upload here</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Upload the Part A and Part B zip files to save them for the respective employees.
                  </p>
                </div>
              </li>
            </ol>

            {/* Help card */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  TRACES-part filenames must follow: <code>Form16_&#123;fy&#125;_&#123;PAN&#125;.pdf</code>. PAN is extracted from the filename and matched against employee profiles.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}