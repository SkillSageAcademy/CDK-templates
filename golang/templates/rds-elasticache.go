package templates

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awselasticache"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsrds"
	"github.com/aws/jsii-runtime-go"
)

func CreateElastiCache() {
	// Create the app properly
	app := awscdk.NewApp(nil)

	// pass it as parameter or use this function as main
	stack := awscdk.NewStack(app, jsii.String("StickySessionStack"), &awscdk.StackProps{
		Env: &awscdk.Environment{
			Account: jsii.String("YOUR_ACCOUNT_ID"),
			Region:  jsii.String("YOUR_REGION"),
		},
	})

	// Create a VPC
	vpc := awsec2.NewVpc(stack, jsii.String("MyVPC"), &awsec2.VpcProps{
		MaxAzs: jsii.Number(2),
		SubnetConfiguration: &[]*awsec2.SubnetConfiguration{
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Public"),
				SubnetType: awsec2.SubnetType_PUBLIC,
			},
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Private"),
				SubnetType: awsec2.SubnetType_PRIVATE_WITH_EGRESS,
			},
		},
	})

	// Create a security group for Elasticache
	cacheSecurityGroup := awsec2.NewSecurityGroup(stack, jsii.String("CacheSecurityGroup"), &awsec2.SecurityGroupProps{
		Vpc:         vpc,
		Description: jsii.String("Security group for Elasticache"),
	})
	cacheSecurityGroup.AddIngressRule(awsec2.Peer_Ipv4(vpc.VpcCidrBlock()), awsec2.Port_Tcp(jsii.Number(6379)), jsii.String("Allow inbound from VPC"), nil)

	// Create the Elasticache cluster
	cacheCluster := awselasticache.NewCfnCacheCluster(stack, jsii.String("MyCacheCluster"), &awselasticache.CfnCacheClusterProps{
		CacheNodeType:       jsii.String("cache.t2.micro"),
		Engine:              jsii.String("redis"),
		NumCacheNodes:       jsii.Number(1),
		VpcSecurityGroupIds: jsii.Strings(*cacheSecurityGroup.SecurityGroupId()),
		ClusterName:         jsii.String("my-cache-cluster"),
	})

	// Create RDS Instance
	seconds := float64(64)
	awsrds.NewDatabaseInstance(stack, jsii.String("MyRDS"), &awsrds.DatabaseInstanceProps{
		Engine:                    awsrds.DatabaseInstanceEngine_POSTGRES(),
		InstanceType:              awsec2.InstanceType_Of(awsec2.InstanceClass_BURSTABLE2, awsec2.InstanceSize_MICRO),
		Vpc:                       vpc,
		VpcSubnets:                &awsec2.SubnetSelection{SubnetType: awsec2.SubnetType_PRIVATE_ISOLATED},
		AllowMajorVersionUpgrade:  jsii.Bool(true),
		AutoMinorVersionUpgrade:   jsii.Bool(true),
		RemovalPolicy:             awscdk.RemovalPolicy_DESTROY,
		StorageEncrypted:          jsii.Bool(true),
		MonitoringInterval:        awscdk.Duration_Seconds(&seconds),
		EnablePerformanceInsights: jsii.Bool(true),
		PubliclyAccessible:        jsii.Bool(false),
	})

}
