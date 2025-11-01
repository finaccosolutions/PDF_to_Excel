import { CheckCircle, Zap, Shield, Target } from 'lucide-react';

export default function Features() {
  const features = [
    {
      icon: Target,
      title: 'Smart Column Detection',
      description: 'Automatically identifies and aligns transaction columns correctly',
      color: 'text-blue-500',
      bgColor: 'bg-blue-50',
    },
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Process bank statements in seconds with accurate results',
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-50',
    },
    {
      icon: Shield,
      title: 'Clean Data',
      description: 'Removes bank headers, footers, and unnecessary information',
      color: 'text-green-500',
      bgColor: 'bg-green-50',
    },
    {
      icon: CheckCircle,
      title: 'Editable Preview',
      description: 'Review and edit transactions before downloading',
      color: 'text-purple-500',
      bgColor: 'bg-purple-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 my-12">
      {features.map((feature, index) => (
        <div
          key={index}
          className="group bg-white rounded-xl p-6 shadow-md hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2 cursor-pointer"
        >
          <div className={`${feature.bgColor} w-14 h-14 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
            <feature.icon className={`w-7 h-7 ${feature.color}`} />
          </div>
          <h3 className="text-lg font-semibold text-gray-800 mb-2">
            {feature.title}
          </h3>
          <p className="text-gray-600 text-sm leading-relaxed">
            {feature.description}
          </p>
        </div>
      ))}
    </div>
  );
}
